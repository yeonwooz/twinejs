import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from '../_lib/session';
import {ensureStoriesDb, searchPages, searchStoriesDbs} from '../_lib/notion';
import {currentDb} from '../_lib/stories-db';

// 저장 위치 고르기 화면(src/dialogs/notion-storage)이 쓰는 엔드포인트. 저장 위치는
// 한 곳뿐이라 고르는 것도 하나다.
//
// GET  → 지금 쓰는 DB, 고를 수 있는 stories DB 목록, 새로 만들 수 있는 페이지 목록.
// POST → {dbId} 로 저장 위치 변경, 또는 {rootId} 로 그 페이지 아래에 만들어 그리로 옮김.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}

	try {
		if (req.method === 'POST') {
			const {dbId, rootId} = (req.body ?? {}) as {
				dbId?: string;
				rootId?: string;
			};
			// 직접 고르든 새로 만들든, 고른 것은 더 이상 기본값이 아니다
			// (status의 chosen이 autoRoot를 본다).
			const chosen = rootId ? await ensureStoriesDb(s.token, rootId) : dbId;

			if (!chosen) {
				res.status(400).json({error: '저장할 곳을 골라 주세요.'});
				return;
			}

			writeSession(res, {
				...s,
				dbId: chosen,
				...(rootId ? {rootId} : {}),
				autoRoot: false
			});
			res.status(200).json({ok: true, dbId: chosen});
			return;
		}

		// 목록은 워크스페이스에서 직접 찾는다 — 세션이 아는 것만 보여주면 노션에
		// 이미 있는 DB를 못 고르고 빈 DB를 또 만들게 된다.
		const [options, pages] = await Promise.all([
			searchStoriesDbs(s.token),
			searchPages(s.token)
		]);

		res.status(200).json({
			options,
			pages,
			// 아직 없으면 여기서 정해진다 — 화면에 "지금 여기 저장됩니다"를 띄우려면
			// 빈 값이 아니라 실제 위치를 알려줘야 한다.
			selected: await currentDb(s, res).catch(() => null),
			isDefault: !!s.autoRoot
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
