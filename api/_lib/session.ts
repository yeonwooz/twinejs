// 세션 쿠키: Notion access token을 COOKIE_SECRET으로 암호화(AES-256-GCM)해서
// httpOnly 쿠키에 담는다. 서버 DB 없이 쿠키 자체가 세션이다. JS(스토리 XSS 포함)는
// httpOnly라 읽을 수 없고, 값도 암호화돼 있어 서버만 복호화한다.
import crypto from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';

export const SESSION_COOKIE = 'retro_session';
export const STATE_COOKIE = 'retro_oauth_state';

// 수명을 두 단계로 나눈다. 한 쿠키에 Notion 토큰과 AI API 키가 같이 들어있지만
// 위험도가 다르다 — 키는 돈이 걸리고, 재입력은 붙여넣기 한 번이면 된다. 반면
// Notion 연결이 끊기면 OAuth를 다시 타야 해서 훨씬 번거롭다.
//
// 세션(Notion 연결): 슬라이딩 7일. 주 1회 회고 리듬에서 재로그인이 잦지 않을 만큼.
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
// AI 키: 입력 시점부터 12시간(고정, 슬라이딩 아님). 회고 한 번은 한 자리에서
// 끝나므로 그 이상 맡아둘 이유가 없다. 슬라이딩으로 두면 자주 쓰는 사용자의 키를
// 무기한 보관하게 되는데, 앱이 스스로 권하는 "단기 유효 키"와 어긋난다.
export const LLM_KEY_MAX_AGE = 60 * 60 * 12;

export interface Session {
	// Notion OAuth access token.
	token: string;
	// 이 사용자의 stories DB id (위저드에서 회고 루트를 고른 뒤 채워짐).
	dbId?: string;
	// 회고 루트 페이지 id (위저드에서 고름).
	rootId?: string;
	workspaceName?: string;
	// LLM API 키(사용자가 앱에서 입력). Notion 토큰과 동일하게 이 봉인 쿠키에만 담긴다
	// — 평문으로 Notion 페이지/클라 JS/서버 DB 어디에도 남기지 않는다.
	llmKey?: string;
	llmProvider?: 'anthropic' | 'openai';
	// 세션 만료 시각(unix 초). Set-Cookie의 Max-Age는 브라우저만 지키므로, 쿠키 값을
	// 복사해 두면 봉인 자체는 무기한 유효했다. 봉인 안에 만료를 넣어 서버가 검사한다.
	exp?: number;
	// AI 키만의 만료 시각(unix 초). 세션보다 먼저 끝난다 — 지나면 unseal이 키를
	// 떼어내고 세션은 그대로 살린다(Notion 연결은 유지, 키만 다시 입력).
	llmExp?: number;
}

function key() {
	const secret = process.env.COOKIE_SECRET;
	if (!secret) {
		throw new Error('COOKIE_SECRET 환경변수가 설정되지 않았습니다.');
	}
	return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

export function seal(data: Session): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
	const pt = Buffer.from(JSON.stringify(data), 'utf8');
	const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, ct]).toString('base64url');
}

export function unseal(value: string | undefined): Session | null {
	if (!value) return null;
	try {
		const buf = Buffer.from(value, 'base64url');
		const iv = buf.subarray(0, 12);
		const tag = buf.subarray(12, 28);
		const ct = buf.subarray(28);
		const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
		decipher.setAuthTag(tag);
		const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
		const s = JSON.parse(pt.toString('utf8')) as Session;
		const now = Math.floor(Date.now() / 1000);
		// 만료 검사(fail closed). exp가 없는 쿠키는 만료 도입 전에 발급된 것 —
		// 무기한 유효하던 바로 그 쿠키들이라 만료 취급한다(재로그인 1회 필요).
		if (typeof s.exp !== 'number' || s.exp <= now) {
			return null;
		}
		// AI 키는 세션보다 먼저 만료된다. 세션 전체를 죽이지 않고 키만 떼어낸다 —
		// Notion 연결은 살아있고 키만 다시 입력받으면 된다. llmExp가 없는 키는
		// 이 만료 도입 전에 저장된 것이라 여기서도 만료 취급(fail closed).
		if (s.llmKey && (typeof s.llmExp !== 'number' || s.llmExp <= now)) {
			delete s.llmKey;
			delete s.llmProvider;
			delete s.llmExp;
		}
		return s;
	} catch {
		return null;
	}
}

export function readCookie(
	req: IncomingMessage,
	name: string
): string | undefined {
	const header = req.headers.cookie;
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		if (part.slice(0, idx).trim() === name) {
			return decodeURIComponent(part.slice(idx + 1).trim());
		}
	}
	return undefined;
}

function appendSetCookie(res: ServerResponse, cookie: string) {
	const prev = res.getHeader('Set-Cookie');
	const arr = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
	arr.push(cookie);
	res.setHeader('Set-Cookie', arr);
}

export function setCookie(
	res: ServerResponse,
	name: string,
	value: string,
	maxAge: number
) {
	appendSetCookie(
		res,
		`${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; ` +
			`HttpOnly; Secure; SameSite=Lax`
	);
}

export function clearCookie(res: ServerResponse, name: string) {
	appendSetCookie(
		res,
		`${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
	);
}

export function getSession(req: IncomingMessage): Session | null {
	return unseal(readCookie(req, SESSION_COOKIE));
}

export function writeSession(res: ServerResponse, session: Session) {
	// exp는 쓸 때마다 새로 계산한다 — 호출부가 {...s, ...} 로 옛 exp를 실어보내도
	// 덮어쓰기 위해서. Max-Age와 같은 슬라이딩 창이 된다.
	//
	// llmExp는 일부러 건드리지 않는다. 여기서 갱신하면 키 수명이 슬라이딩이 되어
	// 자주 쓰는 사용자의 키가 사실상 만료되지 않는다 — 키를 저장하는 쪽(api/llm.ts)이
	// 입력 시점에 한 번만 정한다.
	const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
	setCookie(res, SESSION_COOKIE, seal({...session, exp}), SESSION_MAX_AGE);
}

// 세션 무효화. 서버 세션 저장소가 없으므로 서버가 할 수 있는 건 쿠키 삭제뿐이다
// — 이미 유출된 쿠키 값까지 죽이려면 COOKIE_SECRET을 회전해야 한다(전체 로그아웃).
export function clearSession(res: ServerResponse) {
	clearCookie(res, SESSION_COOKIE);
}
