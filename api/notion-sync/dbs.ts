import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession, writeSession} from '../_lib/session';
import {ensureStoriesDb, searchPages, searchStoriesDbs} from '../_lib/notion';

// 저장 위치 고르기 화면(src/dialogs/notion-storage)이 쓰는 엔드포인트.
//
// 저장할 곳은 두 가지다. 하나로 뭉뚱그렸다가 회고·시나리오가 "root not selected"로
// 깨졌다 — 성격이 다르니 각각 고르게 한다.
// - rootId: 회고·시나리오·스토리 **초안 원고**가 쌓일 페이지.
// - dbId:   twee 스토리가 들어갈 **DB**.
//
// 연결이 안 된 사용자도 여기까지는 올 수 있어야 한다. 401로 막으면 새 환경에서
// 노션에 연결할 길이 위저드밖에 없다 — connected:false로 알려주고 화면이 연결
// 버튼을 띄운다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(200).json({connected: false, options: [], pages: []});
		return;
	}

	try {
		if (req.method === 'POST') {
			const {dbId, rootId, createDbUnder} = (req.body ?? {}) as {
				dbId?: string;
				rootId?: string;
				createDbUnder?: string;
			};
			// createDbUnder는 "이 페이지 아래에 새로 만들기"다. 그 페이지에 이미 stories
			// DB가 있으면 ensureStoriesDb가 그걸 그대로 쓴다(빈 DB를 또 만들지 않는다).
			const chosenDb = createDbUnder
				? await ensureStoriesDb(s.token, createDbUnder)
				: dbId;

			if (!chosenDb && !rootId) {
				res.status(400).json({error: '저장할 곳을 골라 주세요.'});
				return;
			}

			writeSession(res, {
				...s,
				...(chosenDb ? {dbId: chosenDb} : {}),
				...(rootId ? {rootId} : {}),
				// 직접 골랐으니 더는 앱이 정한 기본값이 아니다.
				autoRoot: false
			});
			res.status(200).json({ok: true, dbId: chosenDb, rootId});
			return;
		}

		// 목록은 워크스페이스에서 직접 찾는다 — 세션이 아는 것만 보여주면 노션에 이미
		// 있는 DB를 못 고르고 빈 DB를 또 만들게 된다. 읽기 경로에서는 DB를 만들지도
		// 정하지도 않는다: 화면을 여는 것만으로 빈 DB가 생기던 적이 있다.
		const [options, pages] = await Promise.all([
			searchStoriesDbs(s.token),
			searchPages(s.token)
		]);

		res.status(200).json({
			connected: true,
			options,
			pages,
			selected: {
				dbId: s.dbId ?? options[0]?.id ?? null,
				rootId: s.rootId ?? null
			},
			isDefault: !!s.autoRoot || !s.dbId
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
