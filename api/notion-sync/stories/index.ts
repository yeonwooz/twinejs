import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {listStories, listStoryMeta} from '../../_lib/notion';
import {currentDb} from '../../_lib/stories-db';

// GET /__notion-sync/stories (rewrite) → 이 사용자 stories DB의 RemoteStory[].
// ?meta=1 이면 twee 본문 없이 타임스탬프만 — 클라가 주기적으로 찔러보는 쪽.
//
// 저장 위치는 한 곳이므로 읽는 DB도 하나다. 각 행에 dbId를 붙여 보내는데, 클라가
// "원격에서 삭제됨" 판정을 이번에 실제로 읽은 DB로 한정하는 데 쓴다 — 저장 위치를
// 바꾼 직후 예전 DB의 스토리가 로컬에서 지워지는 것을 막는 장치다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token || !(s.dbId || s.rootId)) {
		res.status(200).json([]);
		return;
	}

	try {
		// 값싼 폴링(?meta=1)에서는 DB를 새로 만들지 않는다 — 세션에 이미 정해진
		// dbId가 있을 때만 읽는다.
		if (req.query.meta && !s.dbId) {
			res.status(200).json([]);
			return;
		}

		const dbId = await currentDb(s, res);
		const listed = req.query.meta
			? await listStoryMeta(s.token, dbId)
			: await listStories(s.token, dbId);

		res.status(200).json(listed.map(row => ({...row, dbId})));
	} catch {
		// 실패 시 빈 목록 — 클라는 로컬 스토리를 그대로 유지한다.
		res.status(200).json([]);
	}
}
