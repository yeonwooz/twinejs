import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../../_lib/session';
import {listStories, listStoryMeta} from '../../_lib/notion';
import {readDbs} from '../../_lib/stories-db';

// GET /__notion-sync/stories (rewrite) → 이 사용자 stories DB의 RemoteStory[].
// ?meta=1 이면 twee 본문 없이 타임스탬프만 — 클라가 주기적으로 찔러보는 쪽.
//
// 기본 저장 위치 하나에, 클라가 `?db=a,b,c`로 알려준 DB들을 더해 읽는다 — 스토리별로
// 저장 위치를 따로 고를 수 있고, 어느 스토리가 어디 있는지는 클라의 장부에만 있다.
//
// 각 행에 dbId를 붙여 보낸다. 클라가 "원격에서 삭제됨" 판정을 **이번에 실제로 읽은 DB**로
// 한정하는 데 쓴다 — 어느 한 DB를 못 읽었을 때 그쪽 스토리가 통째로 지워지는 것을 막는
// 장치다. DB가 여럿이면 더 중요해진다.
function oneOf(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

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

		const dbIds = await readDbs(s, oneOf(req.query.db), res);
		// 한 DB가 실패해도 나머지는 살려 보낸다. 통째로 빈 목록을 주면 클라가 "아무것도
		// 못 봤다"로 처리하는데, 그건 한 곳만 접근 권한이 빠진 경우에 과한 반응이다.
		const perDb = await Promise.all(
			dbIds.map(async dbId => {
				try {
					const listed = req.query.meta
						? await listStoryMeta(s.token, dbId)
						: await listStories(s.token, dbId);

					return listed.map(row => ({...row, dbId}));
				} catch {
					return [];
				}
			})
		);

		res.status(200).json(perDb.flat());
	} catch {
		// 실패 시 빈 목록 — 클라는 로컬 스토리를 그대로 유지한다.
		res.status(200).json([]);
	}
}
