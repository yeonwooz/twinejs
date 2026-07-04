// A dev-server-only persistence backend that mirrors stories to a Notion
// database. The browser can't call the Notion API directly (CORS, and the
// token shouldn't be exposed to client code), so this middleware proxies a
// tiny REST surface under /__notion-sync/.
//
// Configuration comes from .env.local (never committed):
//   NOTION_TOKEN          - a Notion internal integration token
//   NOTION_STORIES_DB_ID  - ID of a database with Name (title),
//                           Story ID (rich text), IFID (rich text) and
//                           Last Synced (date) properties

import type {IncomingMessage} from 'node:http';
import {loadEnv, Plugin} from 'vite';

const NOTION_API_VERSION = '2022-06-28';

// Notion limits: 2000 characters per rich text item, 100 rich text items per
// block. Stay under both.
const RICH_TEXT_CHUNK_SIZE = 1900;
const RICH_TEXT_ITEMS_PER_BLOCK = 90;

interface NotionSyncConfig {
	databaseId: string;
	token: string;
}

interface StoryPayload {
	ifid?: string;
	name?: string;
	twee: string;
}

async function notionRequest(
	config: NotionSyncConfig,
	method: string,
	path: string,
	body?: unknown
): Promise<any> {
	const response = await fetch(`https://api.notion.com/v1${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${config.token}`,
			'Notion-Version': NOTION_API_VERSION,
			'Content-Type': 'application/json'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	if (!response.ok) {
		throw new Error(
			`Notion API ${method} ${path} failed: ${
				response.status
			} ${await response.text()}`
		);
	}

	return response.json();
}

function chunkText(text: string): string[] {
	const chunks: string[] = [];

	for (let i = 0; i < text.length; i += RICH_TEXT_CHUNK_SIZE) {
		chunks.push(text.slice(i, i + RICH_TEXT_CHUNK_SIZE));
	}

	return chunks.length > 0 ? chunks : [''];
}

function tweeToCodeBlocks(twee: string) {
	const chunks = chunkText(twee);
	const blocks = [];

	for (let i = 0; i < chunks.length; i += RICH_TEXT_ITEMS_PER_BLOCK) {
		blocks.push({
			object: 'block',
			type: 'code',
			code: {
				language: 'plain text',
				rich_text: chunks
					.slice(i, i + RICH_TEXT_ITEMS_PER_BLOCK)
					.map(content => ({type: 'text', text: {content}}))
			}
		});
	}

	return blocks;
}

async function findPageByStoryId(config: NotionSyncConfig, storyId: string) {
	const result = await notionRequest(
		config,
		'POST',
		`/databases/${config.databaseId}/query`,
		{filter: {property: 'Story ID', rich_text: {equals: storyId}}}
	);

	return result.results[0];
}

async function upsertStory(
	config: NotionSyncConfig,
	storyId: string,
	{ifid, name, twee}: StoryPayload
) {
	const properties = {
		Name: {title: [{type: 'text', text: {content: name || 'Untitled'}}]},
		'Story ID': {rich_text: [{type: 'text', text: {content: storyId}}]},
		IFID: {rich_text: [{type: 'text', text: {content: ifid ?? ''}}]},
		'Last Synced': {date: {start: new Date().toISOString()}}
	};
	const existingPage = await findPageByStoryId(config, storyId);

	if (existingPage) {
		await notionRequest(config, 'PATCH', `/pages/${existingPage.id}`, {
			properties
		});

		// Replace the page contents wholesale with the new twee source.

		const children = await notionRequest(
			config,
			'GET',
			`/blocks/${existingPage.id}/children?page_size=100`
		);

		for (const block of children.results) {
			await notionRequest(config, 'DELETE', `/blocks/${block.id}`);
		}

		await notionRequest(config, 'PATCH', `/blocks/${existingPage.id}/children`, {
			children: tweeToCodeBlocks(twee)
		});
	} else {
		await notionRequest(config, 'POST', '/pages', {
			parent: {database_id: config.databaseId},
			properties,
			children: tweeToCodeBlocks(twee)
		});
	}
}

async function archiveStory(config: NotionSyncConfig, storyId: string) {
	const existingPage = await findPageByStoryId(config, storyId);

	if (existingPage) {
		await notionRequest(config, 'PATCH', `/pages/${existingPage.id}`, {
			archived: true
		});
	}
}

async function listStories(config: NotionSyncConfig) {
	const result = await notionRequest(
		config,
		'POST',
		`/databases/${config.databaseId}/query`,
		{}
	);
	const stories = [];

	for (const page of result.results) {
		const storyId = page.properties['Story ID']?.rich_text?.[0]?.plain_text;

		if (!storyId) {
			continue;
		}

		const children = await notionRequest(
			config,
			'GET',
			`/blocks/${page.id}/children?page_size=100`
		);
		const twee = children.results
			.filter((block: any) => block.type === 'code')
			.map((block: any) =>
				block.code.rich_text.map((item: any) => item.plain_text).join('')
			)
			.join('');

		if (!twee) {
			continue;
		}

		stories.push({
			storyId,
			twee,
			lastSynced: page.properties['Last Synced']?.date?.start ?? null
		});
	}

	return stories;
}

function readJsonBody(req: IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let body = '';

		req.on('data', chunk => (body += chunk));
		req.on('end', () => {
			try {
				resolve(JSON.parse(body));
			} catch (error) {
				reject(error);
			}
		});
		req.on('error', reject);
	});
}

export function notionSync(): Plugin {
	// Mutating requests are serialized so that two debounced saves of the same
	// story can't race and create duplicate pages.

	let writeQueue: Promise<unknown> = Promise.resolve();

	function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
		const run = writeQueue.then(work, work);

		writeQueue = run.catch(() => {});
		return run;
	}

	return {
		name: 'notion-sync',
		apply: 'serve',
		configureServer(server) {
			const env = loadEnv(server.config.mode, server.config.root, '');
			const config: NotionSyncConfig | undefined =
				env.NOTION_TOKEN && env.NOTION_STORIES_DB_ID
					? {databaseId: env.NOTION_STORIES_DB_ID, token: env.NOTION_TOKEN}
					: undefined;

			if (!config) {
				server.config.logger.warn(
					'[notion-sync] NOTION_TOKEN and/or NOTION_STORIES_DB_ID not set in .env.local; sync is disabled'
				);
			}

			server.middlewares.use(async (req, res, next) => {
				if (!req.url?.startsWith('/__notion-sync/')) {
					return next();
				}

				function respond(status: number, body: unknown) {
					res.statusCode = status;
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(body));
				}

				try {
					if (req.url === '/__notion-sync/status') {
						return respond(200, {enabled: !!config});
					}

					if (!config) {
						return respond(503, {error: 'Notion sync is not configured'});
					}

					if (req.url === '/__notion-sync/stories' && req.method === 'GET') {
						return respond(200, await listStories(config));
					}

					const storyMatch = /^\/__notion-sync\/stories\/([^/?]+)$/.exec(
						req.url
					);

					if (storyMatch) {
						const storyId = decodeURIComponent(storyMatch[1]);

						if (req.method === 'PUT') {
							const payload = await readJsonBody(req);

							await enqueueWrite(() => upsertStory(config, storyId, payload));
							server.config.logger.info(
								`[notion-sync] Synced story "${payload.name}" (${storyId})`
							);
							return respond(200, {ok: true});
						}

						if (req.method === 'DELETE') {
							await enqueueWrite(() => archiveStory(config, storyId));
							server.config.logger.info(
								`[notion-sync] Archived story ${storyId}`
							);
							return respond(200, {ok: true});
						}
					}

					respond(404, {error: 'Unknown notion-sync endpoint'});
				} catch (error) {
					server.config.logger.error(`[notion-sync] ${error}`);
					respond(500, {error: String(error)});
				}
			});
		}
	};
}
