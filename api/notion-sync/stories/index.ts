import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {listStories} from '../../_lib/notion';

// GET /__notion-sync/stories (rewrite) → 이 사용자 stories DB의 RemoteStory[].
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token || !s?.dbId) {
		res.status(200).json([]);
		return;
	}
	try {
		res.status(200).json(await listStories(s.token, s.dbId));
	} catch {
		// 실패 시 빈 목록 — 클라는 로컬 스토리를 그대로 유지한다.
		res.status(200).json([]);
	}
}
