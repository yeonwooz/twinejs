import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {readBlockText} from '../_lib/notion';

// 주차 페이지 본문(회고 초안) 읽기. ?pageId=<주차 페이지 id>
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	const pageId = String(
		Array.isArray(req.query.pageId) ? req.query.pageId[0] : req.query.pageId ?? ''
	);
	if (!pageId) {
		res.status(400).json({error: 'pageId required'});
		return;
	}
	try {
		const draft = (await readBlockText(s.token, pageId)).trim();
		res.status(200).json({draft});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
