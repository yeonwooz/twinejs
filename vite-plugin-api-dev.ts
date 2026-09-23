// `api/` 아래의 Vercel functions를 vite 개발 서버에서 그대로 돌린다.
//
// 배포에서는 이것들이 서버리스 함수이고 vercel.json이 `/__notion-sync/*`를 여기로
// 재작성한다. 로컬에서는 존재하지 않아서 -- vite가 없는 GET에 index.html을 200으로
// 돌려준다 -- 회고·시나리오 위저드, 설정, 스토리별 저장 위치 고르기가 전부 안 돌았다.
// `vercel dev`를 쓰면 되지만 로그인과 프로젝트 링크가 필요하고, 그냥 화면 한번 보려는
// 사람에게 요구할 일이 아니다.
//
// 함수 코드는 손대지 않는다. 여기서 하는 일은 셋뿐이다:
//   1. URL → 파일 찾기(`[id].ts` 같은 동적 구간 포함)
//   2. Vercel이 얹어 주는 것 흉내(req.query, req.body, res.status().json())
//   3. `.env.local`의 NOTION_TOKEN으로 세션 쿠키를 만들어 끼우기
//
// 불러올 때 vite의 `ssrLoadModule`을 쓰지 않는다. nodePolyfills가 `node:crypto`를
// 브라우저 shim(CJS)으로 바꿔 두어서 `exports is not defined`로 깨진다 -- 그건 클라
// 번들에 필요한 별칭이고 서버 코드에 적용되면 안 된다. esbuild로 직접 번들해 node가
// 그대로 불러가게 한다.
//
// 3번이 핵심이다. api 함수들은 OAuth 세션 쿠키를 보는데, 로컬에서 그걸 받으려면 노션
// OAuth를 돌아야 한다. 토큰은 이미 .env.local에 있으니 그걸로 세션을 만들어 준다 --
// 로그인 없이 바로 쓴다.
//
// 쿠키가 이미 있으면 **빠진 칸만 메운다.** 한때 "있으면 아예 안 건드린다"였는데, 예전에
// OAuth로 받아 둔 rootId 없는 쿠키가 계속 남아 있으면 env를 고쳐도 영영 반영되지 않았다.
// 헤더는 "노션에 저장됨"인데(sync는 dbId만 있으면 된다) 작문대에서 [만들기]만 막히는
// 상태가 되고, 로컬에서는 빠져나올 길이 연결 해제밖에 없었다. 실제로 겪었다.
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {loadEnv, type Plugin, type ViteDevServer} from 'vite';

const API_DIR = 'api';

interface DevEnv {
	NOTION_TOKEN?: string;
	NOTION_RETRO_ROOT_PAGE_ID?: string;
	NOTION_STORIES_DB_ID?: string;
}

// vercel.json의 rewrites를 따라간다. 목록이 짧고 잘 안 바뀌어서 파싱하지 않고 적어 둔다 --
// 어긋나면 배포와 로컬이 달라지므로 vercel.json을 고칠 때 여기도 본다.
function rewrite(pathname: string) {
	return pathname.startsWith('/__notion-sync/')
		? pathname.replace('/__notion-sync/', '/api/notion-sync/')
		: pathname;
}

/**
 * `/api/notion/draft` → `api/notion/draft.ts`.
 * `/api/notion-sync/stories/abc` → `api/notion-sync/stories/[id].ts` (params {id: 'abc'})
 */
function resolveHandler(
	root: string,
	pathname: string
): {file: string; params: Record<string, string>} | undefined {
	const segments = pathname
		.replace(/^\/api\/?/, '')
		.split('/')
		.filter(Boolean);
	const params: Record<string, string> = {};
	let dir = path.join(root, API_DIR);

	for (let i = 0; i < segments.length; i++) {
		const last = i === segments.length - 1;
		const segment = segments[i];

		if (last) {
			for (const candidate of [
				`${segment}.ts`,
				path.join(segment, 'index.ts')
			]) {
				if (fs.existsSync(path.join(dir, candidate))) {
					return {file: path.join(dir, candidate), params};
				}
			}

			// 동적 구간: 이 디렉터리의 [x].ts 하나를 쓴다.
			const dynamic = fs
				.readdirSync(dir, {withFileTypes: true})
				.find(entry => entry.isFile() && /^\[.+\]\.ts$/.test(entry.name));

			if (dynamic) {
				params[dynamic.name.slice(1, -4)] = decodeURIComponent(segment);
				return {file: path.join(dir, dynamic.name), params};
			}

			return undefined;
		}

		const next = path.join(dir, segment);

		if (fs.existsSync(next) && fs.statSync(next).isDirectory()) {
			dir = next;
			continue;
		}

		return undefined;
	}

	return undefined;
}

// undefined·빈 값을 걷어낸다 -- 스프레드로 덮을 때 빈 값이 env 값을 지우면 안 된다.
function clean<T extends Record<string, unknown>>(value: T) {
	return Object.fromEntries(
		Object.entries(value).filter(
			([, v]) => v !== undefined && v !== null && v !== ''
		)
	);
}

function readSessionCookie(header?: string) {
	return header
		?.split(';')
		.map(part => part.trim())
		.find(part => part.startsWith('retro_session='))
		?.slice('retro_session='.length);
}

function stripSessionCookie(header?: string) {
	return (header ?? '')
		.split(';')
		.map(part => part.trim())
		.filter(part => part && !part.startsWith('retro_session='))
		.join('; ');
}

async function readBody(req: IncomingMessage) {
	const chunks: Buffer[] = [];

	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}

	if (!chunks.length) {
		return undefined;
	}

	const raw = Buffer.concat(chunks).toString('utf8');

	try {
		return JSON.parse(raw);
	} catch {
		// Vercel도 JSON이 아니면 문자열 그대로 준다.
		return raw;
	}
}

// api/ 아래에서 가장 최근에 손댄 시각. 이게 바뀌면 다시 번들한다 -- 안 그러면 함수를
// 고쳐도 서버를 껐다 켤 때까지 옛 코드가 돈다.
function newestMtime(dir: string): number {
	let newest = 0;

	for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, entry.name);

		newest = Math.max(
			newest,
			entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs
		);
	}

	return newest;
}

const loaded = new Map<string, {stamp: number; mod: Record<string, any>}>();

async function loadHandlerModule(root: string, file: string, stamp: number) {
	const cached = loaded.get(file);

	// `cached?.stamp === stamp`로 쓰면 둘 다 undefined일 때 참이 되어 없는 캐시를
	// 읽는다. 실제로 인자가 밀려 stamp가 undefined로 들어왔을 때 그걸로 터졌다.
	if (cached && cached.stamp === stamp) {
		return cached.mod;
	}

	// 반드시 프로젝트 안에 쓴다. OS 임시 디렉터리에 두면 external로 남긴 패키지
	// (@anthropic-ai/sdk 등)를 node가 못 찾는다 -- 거기서 위로 올라가도 node_modules가
	// 없다. stamp를 파일 이름에 넣어 ESM 모듈 캐시도 함께 비운다.
	const dir = path.join(root, 'node_modules', '.twine-api-dev');
	const name = crypto
		.createHash('sha1')
		.update(`${file}:${stamp}`)
		.digest('hex')
		.slice(0, 12);
	const out = path.join(dir, `${name}.mjs`);

	fs.mkdirSync(dir, {recursive: true});

	await esbuild.build({
		bundle: true,
		entryPoints: [file],
		format: 'esm',
		outfile: out,
		// node 내장과 설치된 패키지는 그대로 둔다 -- 번들할 이유가 없고, @vercel/node의
		// 타입 전용 import는 어차피 사라진다.
		packages: 'external',
		platform: 'node',
		target: 'node18'
	});

	const mod = await import(pathToFileURL(out).href);

	loaded.set(file, {stamp, mod});
	return mod;
}

// res.status(n).json(x) / .send(x) / .end() 만 쓰면 되도록 얹는다 -- api/ 코드가
// 실제로 쓰는 것이 그뿐이다.
function decorate(res: ServerResponse) {
	const typed = res as ServerResponse & {
		status: (code: number) => typeof typed;
		json: (body: unknown) => void;
		send: (body: string) => void;
		redirect: (location: string) => void;
	};

	typed.status = code => {
		typed.statusCode = code;
		return typed;
	};
	typed.json = body => {
		typed.setHeader('Content-Type', 'application/json');
		typed.end(JSON.stringify(body));
	};
	typed.send = body => typed.end(body);
	typed.redirect = location => {
		typed.statusCode = 302;
		typed.setHeader('Location', location);
		typed.end();
	};

	return typed;
}

export function apiDev(): Plugin {
	return {
		name: 'api-dev',
		apply: 'serve',
		configureServer(server: ViteDevServer) {
			const env: DevEnv = loadEnv(server.config.mode, server.config.root, '');

			// api/ 코드는 process.env를 본다(배포에서 Vercel이 채워 준다). vite의
			// loadEnv는 클라 번들용이라 process.env에 올려주지 않으므로 여기서 옮긴다.
			// 이미 설정된 값은 덮지 않는다 -- 셸에서 준 것이 우선이다.
			for (const [key, value] of Object.entries(env)) {
				if (process.env[key] === undefined) {
					process.env[key] = value;
				}
			}
			// 세션을 봉인/해제하는 seal·unseal은 api/ 코드에 있다. 핸들러와 같은 방식으로
			// 불러온다 -- vite의 SSR 로더를 쓰면 nodePolyfills 별칭에 걸린다.
			let sessionMod: Record<string, any> | undefined;

			// .env.local이 채워 줄 수 있는 칸들.
			function envSession() {
				return {
					token: env.NOTION_TOKEN,
					rootId: env.NOTION_RETRO_ROOT_PAGE_ID,
					// 쉼표 목록은 첫 개만 쓴다(예전 .env.local 호환).
					dbId: env.NOTION_STORIES_DB_ID?.split(',')[0].trim()
				};
			}

			/**
			 * 이 요청에 쓸 세션 쿠키. 이미 있는 쿠키는 **덮지 않고 빠진 칸만 메운다.**
			 * 메울 게 없으면 undefined를 돌려 원래 쿠키를 그대로 쓰게 한다.
			 */
			async function devCookie(stamp: number, existing?: string) {
				if (!env.NOTION_TOKEN) {
					return undefined;
				}

				if (!sessionMod) {
					sessionMod = await loadHandlerModule(
						server.config.root,
						path.join(server.config.root, API_DIR, '_lib', 'session.ts'),
						stamp
					);
				}

				const current = existing ? sessionMod.unseal(existing) : null;
				const filled = {...envSession(), ...clean(current ?? {})};

				if (
					current &&
					Object.entries(envSession()).every(
						([key, value]) => !value || (current as any)[key]
					)
				) {
					// 빠진 게 없다 -- 그대로 쓴다.
					return undefined;
				}

				return sessionMod.seal({
					...filled,
					exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
				});
			}

			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				const pathname = rewrite(url.pathname);

				if (!pathname.startsWith('/api/')) {
					return next();
				}

				const match = resolveHandler(server.config.root, pathname);

				if (!match) {
					res.statusCode = 404;
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify({error: `No API route for ${pathname}`}));
					return;
				}

				try {
					const stamp = newestMtime(path.join(server.config.root, API_DIR));

					// 로그인 없이 쓰도록 .env.local로 세션을 채운다. 이미 쿠키가 있으면
					// 빠진 칸만 메운다.
					const existing = readSessionCookie(req.headers.cookie);
					const cookie = await devCookie(stamp, existing);

					if (cookie) {
						req.headers.cookie = [
							stripSessionCookie(req.headers.cookie),
							`retro_session=${cookie}`
						]
							.filter(Boolean)
							.join('; ');
					}

					const mod = await loadHandlerModule(
						server.config.root,
						match.file,
						stamp
					);
					const handler = mod.default;
					const request = req as IncomingMessage & {
						query: Record<string, string>;
						body: unknown;
					};

					request.query = {
						...Object.fromEntries(url.searchParams),
						...match.params
					};
					request.body = await readBody(req);

					await handler(request, decorate(res));
				} catch (error) {
					server.config.logger.error(
						`[api-dev] ${pathname} failed: ${(error as Error).message}`
					);
					res.statusCode = 500;
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify({error: (error as Error).message}));
				}
			});

			server.config.logger.info(
				env.NOTION_TOKEN
					? '[api-dev] Serving api/ locally with a session from NOTION_TOKEN.'
					: '[api-dev] Serving api/ locally. Set NOTION_TOKEN in .env.local to skip the Notion login.'
			);
		}
	};
}
