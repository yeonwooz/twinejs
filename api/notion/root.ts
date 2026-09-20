import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from '../_lib/session';
import {ensureStoriesDb, searchPages} from '../_lib/notion';

// GET: OAuth 동의 때 공유한 페이지 목록(루트 후보).
// POST {pageId}: 루트 선택 → 그 아래 stories DB 확보(없으면 생성) → 세션에
// rootId·dbId 기록. 여기서 정하는 dbId는 **기본** 저장 위치다 — 스토리별로 다른 DB를
// 고를 수 있고, 그 지정은 클라가 들고 `?db=`로 실어 보낸다(api/_lib/stories-db.ts).
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
				// 사용자가 직접 골랐으니 더는 기본값이 아니다(status의 chosen이 이걸 본다).
				autoRoot: false
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
