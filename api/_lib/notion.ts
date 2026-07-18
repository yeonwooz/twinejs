// 토큰 인자 기반 Notion 헬퍼 (fetch). 기존 vite-plugin-notion-sync.ts + scripts/retro.mjs
// 로직을 서버리스용으로 옮긴 것. 로깅에 토큰·키를 남기지 않는다.
const NOTION_VERSION = '2022-06-28';
const CHUNK = 1900; // rich_text item당 최대 2000자
const ITEMS_PER_BLOCK = 100; // code 블록당 rich_text item 최대 100

export async function notion(
	token: string,
	method: string,
	path: string,
	body?: unknown
): Promise<any> {
	const res = await fetch(`https://api.notion.com/v1${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			'Notion-Version': NOTION_VERSION,
			'Content-Type': 'application/json'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) {
		// 메시지에 토큰이 없도록 상태/본문만.
		throw new Error(`Notion ${method} ${path} → ${res.status}: ${await res.text()}`);
	}
	return res.json();
}

export function toNotionId(value?: string): string | undefined {
	if (!value) return undefined;
	const pathPart = String(value).split('?')[0];
	const runs = pathPart.match(/[0-9a-f]{32}/gi);
	if (runs) return runs[runs.length - 1].toLowerCase();
	const stripped = pathPart.replace(/-/g, '').match(/[0-9a-f]{32}/i);
	return stripped ? stripped[0].toLowerCase() : undefined;
}

export async function listChildPages(token: string, pageId: string) {
	const {results} = await notion(
		token,
		'GET',
		`/blocks/${pageId}/children?page_size=100`
	);
	return results
		.filter((b: any) => b.type === 'child_page')
		.map((b: any) => ({id: b.id, title: b.child_page.title}));
}

// 페이지 본문 텍스트를 모은다. 하위 페이지/DB로는 파고들지 않는다.
export async function readBlockText(
	token: string,
	blockId: string
): Promise<string> {
	const {results} = await notion(
		token,
		'GET',
		`/blocks/${blockId}/children?page_size=100`
	);
	let text = '';
	for (const b of results) {
		if (b.type === 'child_page' || b.type === 'child_database') continue;
		const d = b[b.type];
		if (d && typeof d === 'object' && Array.isArray(d.rich_text)) {
			const line = d.rich_text.map((r: any) => r.plain_text ?? '').join('');
			if (line) text += line + '\n';
		}
		if (b.has_children) text += await readBlockText(token, b.id);
	}
	return text;
}

// 회고 루트(또는 지정) 페이지 본문에서 ANTHROPIC_API_KEY를 읽는다.
export async function readAnthropicKey(
	token: string,
	pageId: string
): Promise<string | undefined> {
	const text = await readBlockText(token, pageId);
	const m = text.match(/ANTHROPIC_API_KEY\s*[:=]\s*(sk-ant-[A-Za-z0-9_-]+)/);
	return m ? m[1] : undefined;
}

// --- stories DB (twee 저장소) — vite-plugin-notion-sync.ts와 동일 스키마 ---

export function tweeToCodeBlocks(twee: string) {
	const chunks: string[] = [];
	for (let i = 0; i < twee.length; i += CHUNK) chunks.push(twee.slice(i, i + CHUNK));
	if (chunks.length === 0) chunks.push('');
	const blocks = [];
	for (let i = 0; i < chunks.length; i += ITEMS_PER_BLOCK) {
		blocks.push({
			object: 'block',
			type: 'code',
			code: {
				language: 'plain text',
				rich_text: chunks
					.slice(i, i + ITEMS_PER_BLOCK)
					.map(content => ({type: 'text', text: {content}}))
			}
		});
	}
	return blocks;
}

export function tweeFromBlocks(blocks: any[]): string {
	return blocks
		.filter(b => b.type === 'code')
		.map((b: any) => b.code.rich_text.map((r: any) => r.plain_text).join(''))
		.join('');
}

export async function ensureStoriesDb(
	token: string,
	rootPageId: string
): Promise<string> {
	// 루트 아래 child_database 중 "Twine Stories"를 찾고 없으면 만든다.
	const {results} = await notion(
		token,
		'GET',
		`/blocks/${rootPageId}/children?page_size=100`
	);
	const existing = results.find(
		(b: any) =>
			b.type === 'child_database' &&
			(b.child_database?.title ?? '').includes('Twine Stories')
	);
	if (existing) return existing.id;

	const db = await notion(token, 'POST', '/databases', {
		parent: {type: 'page_id', page_id: rootPageId},
		title: [{type: 'text', text: {content: 'Twine Stories'}}],
		properties: {
			Name: {title: {}},
			'Story ID': {rich_text: {}},
			IFID: {rich_text: {}},
			'Last Synced': {date: {}}
		}
	});
	return db.id;
}

export interface RemoteStory {
	storyId: string;
	twee: string;
	lastSynced: string | null;
	lastEdited: string | null;
}

export async function listStories(
	token: string,
	dbId: string
): Promise<RemoteStory[]> {
	const result = await notion(token, 'POST', `/databases/${dbId}/query`, {});
	const stories: RemoteStory[] = [];
	for (const page of result.results) {
		const storyId = page.properties['Story ID']?.rich_text?.[0]?.plain_text;
		if (!storyId) continue;
		const children = await notion(
			token,
			'GET',
			`/blocks/${page.id}/children?page_size=100`
		);
		const twee = tweeFromBlocks(children.results);
		if (!twee) continue;
		stories.push({
			storyId,
			twee,
			lastSynced: page.properties['Last Synced']?.date?.start ?? null,
			lastEdited: page.last_edited_time ?? null
		});
	}
	return stories;
}

async function findPageByStoryId(token: string, dbId: string, storyId: string) {
	const result = await notion(token, 'POST', `/databases/${dbId}/query`, {
		filter: {property: 'Story ID', rich_text: {equals: storyId}}
	});
	return result.results[0];
}

export async function upsertStory(
	token: string,
	dbId: string,
	storyId: string,
	{ifid, name, twee}: {ifid?: string; name?: string; twee: string}
): Promise<boolean> {
	const properties = {
		Name: {title: [{type: 'text', text: {content: name || 'Untitled'}}]},
		'Story ID': {rich_text: [{type: 'text', text: {content: storyId}}]},
		IFID: {rich_text: [{type: 'text', text: {content: ifid ?? ''}}]},
		'Last Synced': {date: {start: new Date().toISOString()}}
	};
	const existing = await findPageByStoryId(token, dbId, storyId);
	if (existing) {
		const children = await notion(
			token,
			'GET',
			`/blocks/${existing.id}/children?page_size=100`
		);
		if (tweeFromBlocks(children.results) === twee) return false;
		await notion(token, 'PATCH', `/pages/${existing.id}`, {properties});
		for (const block of children.results) {
			await notion(token, 'DELETE', `/blocks/${block.id}`);
		}
		await notion(token, 'PATCH', `/blocks/${existing.id}/children`, {
			children: tweeToCodeBlocks(twee)
		});
	} else {
		await notion(token, 'POST', '/pages', {
			parent: {database_id: dbId},
			properties,
			children: tweeToCodeBlocks(twee)
		});
	}
	return true;
}

export async function archiveStory(token: string, dbId: string, storyId: string) {
	const existing = await findPageByStoryId(token, dbId, storyId);
	if (existing) {
		await notion(token, 'PATCH', `/pages/${existing.id}`, {archived: true});
	}
}
