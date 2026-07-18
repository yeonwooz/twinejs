import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {searchPages} from '../_lib/notion';

// OAuth 동의 때 공유한 페이지 목록 (회고 루트 후보).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	try {
		res.status(200).json({pages: await searchPages(s.token)});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
