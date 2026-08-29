// A dev-server-only persistence backend that mirrors stories to a Notion
// database. The browser can't call the Notion API directly (CORS, and the
// token shouldn't be exposed to client code), so this middleware proxies a
// tiny REST surface under /__notion-sync/.
//
// Configuration comes from .env.local (never committed):
//   NOTION_TOKEN          - a Notion internal integration token
//   NOTION_STORIES_DB_ID  - ID of a database with Name (title), Story ID (rich
//                           text), IFID (rich text) and Last Synced (date)
//                           properties. Several IDs may be listed comma
//                           separated -- one per Notion root page you keep
//                           stories under. All are read; new stories go to the
//                           first.

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

function tweeFromBlocks(blocks: any[]) {
	return blocks
		.filter((block: any) => block.type === 'code')
		.map((block: any) =>
			block.code.rich_text.map((item: any) => item.plain_text).join('')
		)
		.join('');
}

// One database query, shared by listStoryMeta and listStories. Pages without a
// Story ID aren't ours to sync, so they're dropped here and stay dropped --
// which also keeps the two listings in agreement about what exists.
async function queryStoryPages(config: NotionSyncConfig) {
	const result = await notionRequest(
		config,
		'POST',
		`/databases/${config.databaseId}/query`,
		{}
	);
	const pages = [];

	for (const page of result.results) {
		const storyId = page.properties['Story ID']?.rich_text?.[0]?.plain_text;

		if (storyId) {
			pages.push({page, storyId});
		}
	}

	return pages;
}

function pageMeta(page: any, storyId: string) {
	return {
		storyId,
		lastSynced: page.properties['Last Synced']?.date?.start ?? null,
		// Notion rounds this to the minute, so lastSynced (set on every push
		// with full precision) is the better timestamp when both exist.
		lastEdited: page.last_edited_time ?? null
	};
}

// Timestamps only -- no per-page block fetch. This is what the client polls, so
// it has to stay one HTTP request no matter how many stories exist.
async function listStoryMeta(config: NotionSyncConfig) {
	return (await queryStoryPages(config)).map(({page, storyId}) =>
		pageMeta(page, storyId)
	);
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
		const children = await notionRequest(
			config,
			'GET',
			`/blocks/${existingPage.id}/children?page_size=100`
		);

		// Skip no-op pushes (e.g. store repairs dispatched on every app load).
		// Everything meaningful lives in the twee source, and leaving the page
		// untouched keeps its timestamps useful for merge-on-load comparisons.

		if (tweeFromBlocks(children.results) === twee) {
			return false;
		}

		await notionRequest(config, 'PATCH', `/pages/${existingPage.id}`, {
			properties
		});

		// Replace the page contents wholesale with the new twee source.

		for (const block of children.results) {
			await notionRequest(config, 'DELETE', `/blocks/${block.id}`);
		}

		await notionRequest(
			config,
			'PATCH',
			`/blocks/${existingPage.id}/children`,
			{
				children: tweeToCodeBlocks(twee)
			}
		);
	} else {
		await notionRequest(config, 'POST', '/pages', {
			parent: {database_id: config.databaseId},
			properties,
			children: tweeToCodeBlocks(twee)
		});
	}

	return true;
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
	const stories = [];

	for (const {page, storyId} of await queryStoryPages(config)) {
		const children = await notionRequest(
			config,
			'GET',
			`/blocks/${page.id}/children?page_size=100`
		);
		const twee = tweeFromBlocks(children.results);

		if (!twee) {
			continue;
		}

		stories.push({...pageMeta(page, storyId), twee});
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
			// Stories live in exactly one database -- see api/_lib/stories-db.ts for
			// why the multi-database model went away. A comma separated list is still
			// accepted so older .env.local files keep working, but only the first id
			// is used and the rest are called out.
			const databaseIds = (env.NOTION_STORIES_DB_ID ?? '')
				.split(',')
				.map(id => id.trim())
				.filter(Boolean);
			const config: NotionSyncConfig | undefined =
				env.NOTION_TOKEN && databaseIds[0]
					? {databaseId: databaseIds[0], token: env.NOTION_TOKEN}
					: undefined;

			if (!config) {
				server.config.logger.warn(
					'[notion-sync] NOTION_TOKEN and/or NOTION_STORIES_DB_ID not set in .env.local; sync is disabled'
				);
			} else if (databaseIds.length > 1) {
				server.config.logger.warn(
					`[notion-sync] NOTION_STORIES_DB_ID lists ${databaseIds.length} databases; only the first is used (${databaseIds[0]}). Storage is a single database now -- drop the rest.`
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

				// The client polls with a query string, so match on the path alone.
				const url = new URL(req.url, 'http://localhost');

				try {
					if (url.pathname === '/__notion-sync/status') {
						return respond(200, {enabled: !!config});
					}

					if (!config) {
						return respond(503, {error: 'Notion sync is not configured'});
					}

					if (
						url.pathname === '/__notion-sync/stories' &&
						req.method === 'GET'
					) {
						// ?meta=1 is the cheap poll: timestamps without twee bodies.
						const meta = !!url.searchParams.get('meta');
						// Each row carries the database it came from; the client uses that
						// to scope its "deleted in Notion" check to what this listing
						// actually covered, so switching databases can't wipe local copies.
						const listed = meta
							? await listStoryMeta(config)
							: await listStories(config);

						return respond(
							200,
							listed.map(row => ({...row, dbId: config.databaseId}))
						);
					}

					const storyMatch = /^\/__notion-sync\/stories\/([^/?]+)$/.exec(
						url.pathname
					);

					if (storyMatch) {
						const storyId = decodeURIComponent(storyMatch[1]);

						if (req.method === 'PUT') {
							const payload: StoryPayload = await readJsonBody(req);
							const wrote = await enqueueWrite(() =>
								upsertStory(config, storyId, payload)
							);

							server.config.logger.info(
								`[notion-sync] ${
									wrote ? 'Synced' : 'Already up to date:'
								} story "${payload.name}" (${storyId})`
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
