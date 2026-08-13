import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {listStories, listStoryMeta} from '../../_lib/notion';

// GET /__notion-sync/stories (rewrite) → 이 사용자 stories DB의 RemoteStory[].
// ?meta=1 이면 twee 본문 없이 타임스탬프만 — 클라가 주기적으로 찔러보는 쪽.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token || !s?.dbId) {
		res.status(200).json([]);
		return;
	}
	try {
		res
			.status(200)
			.json(
				req.query.meta
					? await listStoryMeta(s.token, s.dbId)
					: await listStories(s.token, s.dbId)
			);
	} catch {
		// 실패 시 빈 목록 — 클라는 로컬 스토리를 그대로 유지한다.
		res.status(200).json([]);
	}
}
