import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {listStories, listStoryMeta} from '../../_lib/notion';
import {allDbs} from '../../_lib/stories-db';

// GET /__notion-sync/stories (rewrite) → 이 사용자 stories DB의 RemoteStory[].
// ?meta=1 이면 twee 본문 없이 타임스탬프만 — 클라가 주기적으로 찔러보는 쪽.
//
// 세션에서 써 본 DB를 전부 합쳐 읽는다(보통 한 개, 루트를 바꿔가며 쓰면 여러 개).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token || !(s.dbId || s.rootId)) {
		res.status(200).json([]);
		return;
	}
	try {
		// 값싼 폴링(?meta=1)에서는 DB를 새로 뒤지지 않는다 — 전체 목록 요청 때 찾아
		// 세션에 캐시된 id를 쓴다.
		const dbs = await allDbs(s, res, {discover: !req.query.meta});
		const rows = [];

		for (const dbId of dbs) {
			rows.push(
				...(req.query.meta
					? await listStoryMeta(s.token, dbId)
					: await listStories(s.token, dbId))
			);
		}

		res.status(200).json(rows);
	} catch {
		// 실패 시 빈 목록 — 클라는 로컬 스토리를 그대로 유지한다.
		res.status(200).json([]);
	}
}
