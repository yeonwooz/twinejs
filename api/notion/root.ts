import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from '../_lib/session';
import {ensureStoriesDb, searchPages} from '../_lib/notion';

// GET: OAuth 동의 때 공유한 페이지 목록(루트 후보).
// POST {pageId}: 루트 선택 → 그 아래 stories DB 확보(없으면 생성) → 세션에
// rootId·dbId 기록. 회고든 창작 시나리오든 이 DB 하나를 쓴다 — 나누는 기준은
// 종류가 아니라 루트 페이지다. 예전에 쓰던 DB는 dbIds에 남겨 계속 읽는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}

	if (req.method === 'POST') {
		const pageId = (req.body?.pageId ?? '') as string;
		if (!pageId) {
			res.status(400).json({error: 'pageId required'});
			return;
		}
		try {
			const dbId = await ensureStoriesDb(s.token, pageId);
			writeSession(res, {
				...s,
				rootId: pageId,
				dbId,
				dbIds: [...new Set([dbId, ...(s.dbIds ?? [])])]
			});
			res.status(200).json({ok: true});
		} catch (error) {
			res.status(502).json({error: (error as Error).message});
		}
		return;
	}

	try {
		res.status(200).json({pages: await searchPages(s.token)});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
