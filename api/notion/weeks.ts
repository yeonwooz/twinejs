import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {weekPages} from '../_lib/notion';

// 선택한 회고 루트 아래 "N주차 회고" 목록.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	if (!s.rootId) {
		res.status(400).json({error: 'root not selected'});
		return;
	}
	try {
		res.status(200).json({weeks: await weekPages(s.token, s.rootId)});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
