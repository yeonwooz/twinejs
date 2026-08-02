// 세션 쿠키: Notion access token을 COOKIE_SECRET으로 암호화(AES-256-GCM)해서
// httpOnly 쿠키에 담는다. 서버 DB 없이 쿠키 자체가 세션이다. JS(스토리 XSS 포함)는
// httpOnly라 읽을 수 없고, 값도 암호화돼 있어 서버만 복호화한다.
import crypto from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';

export const SESSION_COOKIE = 'retro_session';
export const STATE_COOKIE = 'retro_oauth_state';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30일

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
	// 만료 시각(unix 초). Set-Cookie의 Max-Age는 브라우저만 지키므로, 쿠키 값을
	// 복사해 두면 봉인 자체는 무기한 유효했다. 봉인 안에 만료를 넣어 서버가 검사한다.
	exp?: number;
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
		// 만료 검사(fail closed). exp가 없는 쿠키는 만료 도입 전에 발급된 것 —
		// 무기한 유효하던 바로 그 쿠키들이라 만료 취급한다(재로그인 1회 필요).
		if (typeof s.exp !== 'number' || s.exp <= Math.floor(Date.now() / 1000)) {
			return null;
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
	// 덮어쓰기 위해서. Max-Age와 같은 슬라이딩 30일 창이 된다.
	const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
	setCookie(res, SESSION_COOKIE, seal({...session, exp}), SESSION_MAX_AGE);
}

// 세션 무효화. 서버 세션 저장소가 없으므로 서버가 할 수 있는 건 쿠키 삭제뿐이다
// — 이미 유출된 쿠키 값까지 죽이려면 COOKIE_SECRET을 회전해야 한다(전체 로그아웃).
export function clearSession(res: ServerResponse) {
	clearCookie(res, SESSION_COOKIE);
}
