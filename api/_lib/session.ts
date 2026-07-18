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
		return JSON.parse(pt.toString('utf8')) as Session;
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
	setCookie(res, SESSION_COOKIE, seal(session), SESSION_MAX_AGE);
}
