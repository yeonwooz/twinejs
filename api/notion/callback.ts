import type {VercelRequest, VercelResponse} from '@vercel/node';
import {
	readCookie,
	clearCookie,
	writeSession,
	STATE_COOKIE
} from '../_lib/session';

const first = (v: string | string[] | undefined) =>
	Array.isArray(v) ? v[0] : v;

// Notion OAuth 콜백: code→token 교환(client_secret은 서버 env), 세션 쿠키 설정 후 앱으로.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const code = first(req.query.code as string | string[] | undefined);
	const state = first(req.query.state as string | string[] | undefined);
	const error = first(req.query.error as string | string[] | undefined);

	const expected = readCookie(req, STATE_COOKIE);
	clearCookie(res, STATE_COOKIE);

	if (error) {
		res.writeHead(302, {Location: '/#/retro?notion=denied'});
		res.end();
		return;
	}
	if (!code || !state || !expected || state !== expected) {
		res.status(400).send('OAuth state 검증 실패');
		return;
	}

	const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
	const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
	const redirectUri = process.env.NOTION_REDIRECT_URI;
	if (!clientId || !clientSecret || !redirectUri) {
		res.status(500).send('OAuth env 미설정');
		return;
	}

	const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/json',
			'Notion-Version': '2022-06-28'
		},
		body: JSON.stringify({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri
		})
	});

	if (!tokenRes.ok) {
		res.status(502).send('Notion 토큰 교환 실패');
		return;
	}

	const data = (await tokenRes.json()) as {
		access_token: string;
		workspace_name?: string;
		owner?: {type?: string; user?: {id?: string}};
	};
	// 새 연결은 저장 위치를 다시 고르게 한다. 같은 워크스페이스에서 공개 통합은 봇을
	// 하나만 두므로, 다른 사람이 공유한 페이지·DB도 이 토큰으로 보인다 — 예전 세션의
	// 선택을 이어받지 않고, 사용자가 자기 페이지를 고르게 하는 편이 안전하다.
	writeSession(res, {
		token: data.access_token,
		workspaceName: data.workspace_name,
		userId: data.owner?.user?.id
	});

	res.writeHead(302, {Location: '/#/retro?notion=connected'});
	res.end();
}
