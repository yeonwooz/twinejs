import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from '../_lib/session';
import {ensureStoriesDb} from '../_lib/notion';

// 회고 루트 선택 → 그 아래 stories DB 확보(없으면 생성) → 세션에 rootId·dbId 기록.
// (dbId가 세션에 들어와야 sync가 활성화됨 — status가 enabled:true)
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	const pageId = (req.body?.pageId ?? '') as string;
	if (!pageId) {
		res.status(400).json({error: 'pageId required'});
		return;
	}
	try {
		const dbId = await ensureStoriesDb(s.token, pageId);
		writeSession(res, {...s, rootId: pageId, dbId});
		res.status(200).json({ok: true});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
