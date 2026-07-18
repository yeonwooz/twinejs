import type {VercelRequest, VercelResponse} from '@vercel/node';
import crypto from 'node:crypto';
import {setCookie, STATE_COOKIE} from '../_lib/session';

// "Notion으로 연결" → Notion OAuth authorize로 리다이렉트. CSRF용 state를 짧은 쿠키에 둔다.
export default function handler(req: VercelRequest, res: VercelResponse) {
	const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
	const redirectUri = process.env.NOTION_REDIRECT_URI;
	if (!clientId || !redirectUri) {
		res.status(500).send('NOTION_OAUTH_CLIENT_ID / NOTION_REDIRECT_URI 미설정');
		return;
	}
	const state = crypto.randomBytes(16).toString('hex');
	setCookie(res, STATE_COOKIE, state, 600); // 10분

	const url = new URL('https://api.notion.com/v1/oauth/authorize');
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('owner', 'user');
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('state', state);

	res.writeHead(302, {Location: url.toString()});
	res.end();
}
