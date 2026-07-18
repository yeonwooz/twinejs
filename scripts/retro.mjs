#!/usr/bin/env node
// `npm start` 진입점: 회고 번역 플로우 오케스트레이터.
//
//   1. .env.local 로드 · 검증 (없으면 설정 안내 후 종료)
//   2. stories DB가 없으면 회고 루트 페이지 아래에 자동 생성 → .env.local에 기록
//   3. 어느 주차 회고인지 고른 뒤, 노션 초안을 읽어 Anthropic API로 twee 번역
//      (빈 조건이 있으면 터미널에서 물어보고 원본 초안도 채워 넣는다)
//   4. stories DB에 upsert → 앱이 로드 시 pull
//   5. Play / 보완 선택. Play면 개발 서버를 띄워 그 스토리를 바로 재생
//
// 개발 서버만 단독으로 띄우려면 `npm run dev`.
// 필요한 env: NOTION_TOKEN, NOTION_RETRO_ROOT_PAGE_ID, ANTHROPIC_API_KEY
//            (NOTION_STORIES_DB_ID는 첫 실행 때 자동 생성·기록)

import Anthropic from '@anthropic-ai/sdk';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {existsSync, readFileSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');
const NOTION_VERSION = '2022-06-28';
const MODEL = 'claude-opus-4-8';

// --- .env 파싱 (dotenv 없이) ---------------------------------------------

function loadEnvFile(file) {
	if (!existsSync(file)) return {};
	const out = {};
	for (const raw of readFileSync(file, 'utf8').split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		out[key] = val;
	}
	return out;
}

// URL이든 대시 있는 uuid든 32자리 hex id로 정규화.
// - 쿼리스트링(?v=…) 제거 후 경로에서 찾는다(DB 링크의 view id 오인 방지).
// - 페이지 URL "Title-<id>"는 마지막 32-hex 런이 id.
// - 대시 uuid는 런이 안 잡히므로 대시를 지워 매칭.
function toNotionId(value) {
	if (!value) return undefined;
	const pathPart = String(value).split('?')[0];
	const runs = pathPart.match(/[0-9a-f]{32}/gi);
	if (runs) return runs[runs.length - 1].toLowerCase();
	const stripped = pathPart.replace(/-/g, '').match(/[0-9a-f]{32}/i);
	return stripped ? stripped[0].toLowerCase() : undefined;
}

// --- Notion API ----------------------------------------------------------

let NOTION_TOKEN;
async function notion(method, apiPath, body) {
	const res = await fetch(`https://api.notion.com/v1${apiPath}`, {
		method,
		headers: {
			Authorization: `Bearer ${NOTION_TOKEN}`,
			'Notion-Version': NOTION_VERSION,
			'Content-Type': 'application/json'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok) {
		throw new Error(`Notion ${method} ${apiPath} → ${res.status}: ${await res.text()}`);
	}
	return res.json();
}

// 블록 텍스트를 재귀적으로 모아 하나의 문자열로.
async function readBlockText(blockId, depth = 0) {
	const {results} = await notion(
		'GET',
		`/blocks/${blockId}/children?page_size=100`
	);
	let text = '';
	for (const b of results) {
		// 하위 페이지/DB는 본문이 아니므로 건너뛴다(파고들지 않음).
		if (b.type === 'child_page' || b.type === 'child_database') continue;
		const d = b[b.type];
		if (d && typeof d === 'object' && Array.isArray(d.rich_text)) {
			const line = d.rich_text.map(r => r.plain_text ?? '').join('');
			if (line) text += line + '\n';
		}
		if (b.has_children) text += await readBlockText(b.id, depth + 1);
	}
	return text;
}

async function listChildPages(pageId) {
	const {results} = await notion(
		'GET',
		`/blocks/${pageId}/children?page_size=100`
	);
	return results
		.filter(b => b.type === 'child_page')
		.map(b => ({id: b.id, title: b.child_page.title}));
}

// stories DB 스키마는 vite-plugin-notion-sync.ts의 upsertStory/listStories와 일치.
async function createStoriesDb(rootPageId) {
	const db = await notion('POST', '/databases', {
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

function tweeCodeBlocks(twee) {
	const size = 1900;
	const chunks = [];
	for (let i = 0; i < twee.length; i += size) chunks.push(twee.slice(i, i + size));
	if (chunks.length === 0) chunks.push('');
	return [
		{
			object: 'block',
			type: 'code',
			code: {
				language: 'plain text',
				rich_text: chunks.map(c => ({type: 'text', text: {content: c}}))
			}
		}
	];
}

async function replaceChildren(pageId, blocks) {
	const {results} = await notion('GET', `/blocks/${pageId}/children?page_size=100`);
	for (const b of results) await notion('DELETE', `/blocks/${b.id}`);
	await notion('PATCH', `/blocks/${pageId}/children`, {children: blocks});
}

// 페이지 본문(텍스트) 블록만 교체하고 하위 페이지/DB는 보존한다.
async function replaceTextChildren(pageId, blocks) {
	const {results} = await notion('GET', `/blocks/${pageId}/children?page_size=100`);
	for (const b of results) {
		if (b.type === 'child_page' || b.type === 'child_database') continue;
		await notion('DELETE', `/blocks/${b.id}`);
	}
	await notion('PATCH', `/blocks/${pageId}/children`, {children: blocks});
}

// 스토리 이름에서 주차 번호를 뽑는다 ("3주차 회고 — …" → 3).
function weekOfName(name) {
	const m = (name || '').match(/(\d+)\s*주차/);
	return m ? Number(m[1]) : -1;
}

// stories DB에 upsert. **같은 주차 스토리가 이미 있으면 Story ID를 유지한 채 덮어쓴다**
// (제목이 아니라 주차 번호로 매칭 — 재실행 때 제목이 조금 달라져도 중복이 안 생긴다).
async function upsertStory(dbId, {weekN, title, ifid, twee}) {
	const {results} = await notion('POST', `/databases/${dbId}/query`, {});
	const nameOf = pg => pg.properties['Name']?.title?.[0]?.plain_text || '';
	const page = results.find(pg => weekOfName(nameOf(pg)) === weekN);
	if (page) {
		const storyId =
			page.properties['Story ID']?.rich_text?.[0]?.plain_text ?? randomUUID();
		await notion('PATCH', `/pages/${page.id}`, {
			properties: {
				Name: {title: [{type: 'text', text: {content: title}}]},
				IFID: {rich_text: [{type: 'text', text: {content: ifid}}]}
			}
		});
		await replaceChildren(page.id, tweeCodeBlocks(twee));
		return {storyId, overwritten: true};
	}
	const storyId = randomUUID();
	await notion('POST', '/pages', {
		parent: {database_id: dbId},
		properties: {
			Name: {title: [{type: 'text', text: {content: title}}]},
			'Story ID': {rich_text: [{type: 'text', text: {content: storyId}}]},
			IFID: {rich_text: [{type: 'text', text: {content: ifid}}]}
		},
		children: tweeCodeBlocks(twee)
	});
	return {storyId, overwritten: false};
}

// --- twee 검증 -----------------------------------------------------------

function validateTwee(twee) {
	const titles = new Set([...twee.matchAll(/^:: (.+)$/gm)].map(m => m[1].trim()));
	const links = [...twee.matchAll(/\[\[[^\]]*?->([^\]]+)\]\]/g)].map(m => m[1].trim());
	const missing = links.filter(l => !titles.has(l));
	const sdMatch = twee.match(/:: StoryData\n(\{[\s\S]*?\})/);
	let start;
	try {
		start = sdMatch ? JSON.parse(sdMatch[1]).start : undefined;
	} catch {
		/* ignore */
	}
	const problems = [];
	if (missing.length) problems.push(`끊긴 링크 대상: ${[...new Set(missing)].join(', ')}`);
	if (!start || !titles.has(start)) problems.push(`StoryData.start "${start}"가 구절로 없음`);
	return problems;
}

function tweeTitle(twee) {
	const m = twee.match(/:: StoryTitle\n(.+)/);
	return m ? m[1].trim() : '인터랙티브 회고';
}

function tweeIfid(twee) {
	const m = twee.match(/:: StoryData\n(\{[\s\S]*?\})/);
	try {
		return m ? JSON.parse(m[1]).ifid : undefined;
	} catch {
		return undefined;
	}
}

// --- Anthropic: 초안 → twee ---------------------------------------------

// 번역 동작의 단일 소스 — 규칙·컨셉·형식은 이 파일이 전부다.
const SYSTEM_PROMPT = readFileSync(path.join(ROOT, 'scripts', 'retro-prompt.md'), 'utf8');

// 우주 테마 스타일시트 — 생성된 twee에 항상 붙인다(모델이 만들지 않는다).
// 우주 테마 스타일시트 — retro.mjs와 api/translate가 공유하는 단일 소스.
const COSMIC_STYLESHEET = readFileSync(
	path.join(ROOT, 'scripts', 'cosmic-stylesheet.txt'),
	'utf8'
).trimEnd();

// 모델이 만든 stylesheet 구절이 있으면 제거하고, 우주 테마 스타일시트를 붙인다.
function withCosmicUI(twee) {
	const stripped = twee.replace(
		/\n:: [^\n]*\[stylesheet\][\s\S]*?(?=\n:: |\s*$)/g,
		''
	);
	return stripped.trimEnd() + '\n\n' + COSMIC_STYLESHEET + '\n';
}

const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['questions', 'twee', 'draftUpdate'],
	properties: {
		questions: {type: 'array', items: {type: 'string'}},
		twee: {type: 'string'},
		draftUpdate: {type: 'string'}
	}
};

async function translate(anthropic, {draftText, weekLabel, qa, existingTwee, feedback}) {
	let user = `주차: ${weekLabel}\n\n회고 초안:\n"""\n${draftText}\n"""\n`;
	if (existingTwee) {
		user += `\n기존 twee(구절 제목과 StoryData를 유지):\n"""\n${existingTwee}\n"""\n`;
	}
	if (feedback) {
		user += `\n보완 요청: ${feedback}\n`;
	}
	if (qa && qa.length) {
		user +=
			'\n앞선 질문에 대한 사용자 답변:\n' +
			qa.map(([q, a]) => `- Q: ${q}\n  A: ${a}`).join('\n') +
			'\n이 답변을 반영하고, 더 물을 게 없으면 questions는 빈 배열로 둔다.\n';
	}
	const response = await anthropic.messages.create({
		model: MODEL,
		max_tokens: 16000,
		thinking: {type: 'adaptive'},
		system: SYSTEM_PROMPT,
		output_config: {format: {type: 'json_schema', schema: OUTPUT_SCHEMA}},
		messages: [{role: 'user', content: user}]
	});
	const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
	return JSON.parse(text);
}

// --- 자식 프로세스 / 안내 -----------------------------------------------

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runDev(playPath) {
	return new Promise((resolve, reject) => {
		const child = spawn(npmCmd, ['run', 'dev', '--', '--open', playPath], {
			cwd: ROOT,
			stdio: 'inherit',
			shell: process.platform === 'win32'
		});
		child.on('error', reject);
		child.on('exit', code => resolve(code ?? 0));
	});
}

function printSetupGuide(missing) {
	console.error(`
[retro] 설정이 필요합니다 (없는 값: ${missing.join(', ')}).
저장소 루트에 .env.local을 만들고 아래를 채워주세요. (.env.example 참고)

  NOTION_TOKEN=<Notion 통합 토큰>
  NOTION_RETRO_ROOT_PAGE_ID=<회고 루트 페이지 링크 또는 ID>
  ANTHROPIC_API_KEY=<Anthropic API 키>

준비 방법:
  1) https://www.notion.so/my-integrations 에서 통합을 만들어 토큰을 NOTION_TOKEN에.
  2) 회고 루트 페이지를 그 통합에 연결(Connections)하고, 페이지 링크를 NOTION_RETRO_ROOT_PAGE_ID에.
  3) https://console.anthropic.com/ 에서 API 키를 발급해 ANTHROPIC_API_KEY에.
  NOTION_STORIES_DB_ID는 첫 실행 때 자동으로 만들어 이 파일에 기록합니다.
`);
}

// --- 메인 ----------------------------------------------------------------

async function main() {
	const env = {...loadEnvFile(path.join(ROOT, '.env')), ...loadEnvFile(ENV_LOCAL)};
	NOTION_TOKEN = env.NOTION_TOKEN;
	const rootPageId = toNotionId(env.NOTION_RETRO_ROOT_PAGE_ID);
	const apiKey = env.ANTHROPIC_API_KEY;

	const missing = [];
	if (!NOTION_TOKEN) missing.push('NOTION_TOKEN');
	if (!rootPageId) missing.push('NOTION_RETRO_ROOT_PAGE_ID');
	if (!apiKey) missing.push('ANTHROPIC_API_KEY');
	if (missing.length) {
		printSetupGuide(missing);
		process.exit(1);
	}

	// stories DB 확보.
	let dbId = toNotionId(env.NOTION_STORIES_DB_ID);
	if (!dbId) {
		console.log('[retro] stories DB가 없어 회고 루트 페이지 아래에 새로 만듭니다…');
		dbId = toNotionId(await createStoriesDb(rootPageId));
		appendFileSync(ENV_LOCAL, `\nNOTION_STORIES_DB_ID=${dbId}\n`);
		console.log(`[retro] stories DB 생성 완료 → .env.local에 기록 (${dbId}).`);
	}

	const anthropic = new Anthropic({apiKey});
	const rl = createInterface({input: process.stdin, output: process.stdout});
	const ask = q => rl.question(q);

	try {
		// 1. 어느 주차 회고인지 물어본다.
		const weeks = (await listChildPages(rootPageId)).filter(p =>
			/주차/.test(p.title)
		);
		if (weeks.length === 0) {
			throw new Error('루트 페이지에 "N주차 회고" 하위 페이지가 없습니다. 노션에서 먼저 만들어 주세요.');
		}
		const weekNum = t => {
			const m = t.match(/(\d+)\s*주차/);
			return m ? Number(m[1]) : -1;
		};
		weeks.sort((a, b) => weekNum(a.title) - weekNum(b.title));
		const available = weeks.map(w => weekNum(w.title)).filter(n => n > 0);

		let week;
		for (;;) {
			const answer = (
				await ask(`\n몇 주차 회고를 쓸까요? (있는 주차: ${available.join(', ')}) > `)
			).trim();
			const n = Number(answer.match(/\d+/)?.[0]);
			week = weeks.find(w => weekNum(w.title) === n);
			if (week) break;
			console.log(`  '${answer || '?'}'주차 회고를 찾지 못했어요. 위 목록에서 골라 주세요.`);
		}
		console.log(`[retro] 작업 주차: ${week.title}`);

		// 2. 초안 소스 = "N주차 회고" 페이지 본문.
		//    (별도 "회고 초안" 하위 페이지는 필수 아님 — 있으면 그걸 우선 사용)
		const pages = await listChildPages(week.id);
		const draftPage = pages.find(p => /초안/.test(p.title));
		const draftSourceId = draftPage ? draftPage.id : week.id;
		const draftText = (await readBlockText(draftSourceId)).trim();
		if (!draftText) {
			throw new Error(
				`"${week.title}" 페이지에 회고 내용이 없습니다. 그 페이지 본문에 회고를 작성해 주세요.`
			);
		}
		console.log(
			`[retro] ${
				draftPage ? `"${draftPage.title}"` : `"${week.title}" 본문`
			} 읽음 (${draftText.length}자).`
		);

		const weekN = weekNum(week.title);

		// 같은 주차 스토리가 이미 있으면 덮어쓴다 — 기존 twee를 참고해 제목·구절·ifid를 고정.
		let existingTwee;
		{
			const {results} = await notion('POST', `/databases/${dbId}/query`, {});
			const page = results.find(
				pg => weekOfName(pg.properties['Name']?.title?.[0]?.plain_text || '') === weekN
			);
			if (page) {
				const kids = await notion('GET', `/blocks/${page.id}/children?page_size=100`);
				existingTwee =
					kids.results
						.filter(b => b.type === 'code')
						.map(b => b.code.rich_text.map(x => x.plain_text).join(''))
						.join('') || undefined;
				if (existingTwee) {
					console.log('[retro] 같은 주차 스토리가 이미 있어요 — 덮어씁니다(제목·구절 유지).');
				}
			}
		}

		// 3. 번역 + 빈 조건 Q&A 루프.
		console.log('[retro] Anthropic으로 번역 중…');
		let result = await translate(anthropic, {draftText, weekLabel: week.title, existingTwee});
		let qa = [];
		for (let round = 0; result.questions.length && round < 3; round++) {
			console.log('\n초안에 비어 있는 조건이 있어요. 답해 주세요:');
			for (const q of result.questions) {
				const a = await ask(`- ${q}\n  > `);
				qa.push([q, a]);
			}
			console.log('[retro] 답변 반영해 다시 번역 중…');
			result = await translate(anthropic, {draftText, weekLabel: week.title, qa});
		}

		// 4. 검증(문제 있으면 1회 보정 시도).
		let problems = validateTwee(result.twee);
		if (problems.length) {
			console.log(`[retro] twee 문제 감지, 보정 시도: ${problems.join('; ')}`);
			result = await translate(anthropic, {
				draftText,
				weekLabel: week.title,
				qa,
				existingTwee: result.twee,
				feedback: `다음 문제를 고쳐라: ${problems.join('; ')}`
			});
			problems = validateTwee(result.twee);
		}
		if (problems.length) {
			console.warn(`[retro] 경고: twee에 문제가 남아 있습니다: ${problems.join('; ')}`);
		}

		// 5. 원본 회고(주차 페이지 본문) 업데이트(규칙 1) + stories DB upsert.
		if (result.draftUpdate && result.draftUpdate.trim() !== draftText) {
			const paras = result.draftUpdate
				.split(/\n{2,}/)
				.map(p => p.trim())
				.filter(Boolean)
				.map(p => ({
					object: 'block',
					type: 'paragraph',
					paragraph: {rich_text: [{type: 'text', text: {content: p}}]}
				}));
			// 본문 텍스트만 교체하고 하위 페이지/DB는 보존.
			await replaceTextChildren(draftSourceId, paras);
			console.log(
				`[retro] 원본 회고(${
					draftPage ? draftPage.title : week.title
				})를 완성본으로 업데이트했습니다.`
			);
		}

		let title = tweeTitle(result.twee);
		let ifid = tweeIfid(result.twee) ?? randomUUID().toUpperCase();
		let {storyId, overwritten} = await upsertStory(dbId, {
			weekN,
			title,
			ifid,
			twee: withCosmicUI(result.twee)
		});
		console.log(
			`[retro] stories DB에 ${overwritten ? '덮어썼습니다' : '새로 만들었습니다'}: "${title}" (storyId=${storyId})`
		);
		existingTwee = result.twee;

		// 6. Play / 보완 루프.
		for (;;) {
			const choice = (
				await ask('\n무엇을 할까요? [p] Play  [r] 보완  [q] 종료: ')
			)
				.trim()
				.toLowerCase();
			if (choice === 'r' || choice === '보완') {
				const feedback = await ask('무엇을 보완할까요? > ');
				console.log('[retro] 보완 반영해 다시 번역 중…');
				result = await translate(anthropic, {
					draftText,
					weekLabel: week.title,
					qa,
					existingTwee,
					feedback
				});
				const probs = validateTwee(result.twee);
				if (probs.length) console.warn(`[retro] 경고: ${probs.join('; ')}`);
				title = tweeTitle(result.twee);
				ifid = tweeIfid(result.twee) ?? ifid;
				({storyId} = await upsertStory(dbId, {
					weekN,
					title,
					ifid,
					twee: withCosmicUI(result.twee)
				}));
				existingTwee = result.twee;
				console.log('[retro] 갱신 완료.');
			} else if (choice === 'p' || choice === 'play') {
				rl.close();
				const playPath = `/#/stories/${storyId}/play`;
				console.log(`\n[retro] 개발 서버를 띄워 재생합니다 → ${playPath}\n`);
				await runDev(playPath);
				return;
			} else {
				console.log('종료합니다. (개발 서버는 `npm run dev`로 직접 실행할 수 있어요.)');
				break;
			}
		}
	} finally {
		rl.close();
	}
}

main().catch(error => {
	console.error(`[retro] 오류: ${error.message}`);
	process.exit(1);
});
