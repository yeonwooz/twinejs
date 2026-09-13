import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {searchPages} from '../_lib/notion';
import {chooseRoot} from '../_lib/stories-db';

const NOTION_ID =
	/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// 저장 위치(루트 페이지) 고르기. 회고·시나리오 위저드의 루트 단계와 홈의 "저장 위치"
// 화면(src/dialogs/notion-storage)이 둘 다 이 하나를 쓴다 — 고르는 길이 둘이어서
// 서로 다른 것을 세션에 적던 것이 저장 위치가 뒤죽박죽이 된 원인 중 하나였다.
//
// GET: 고를 수 있는 페이지 목록(OAuth 때 공유된 것들)과 지금 선택. 연결이 안 됐어도
//   401이 아니라 connected:false — 저장 위치 화면이 여기서 연결 버튼을 띄운다.
// POST {pageId}: 그 페이지를 루트로. 아래 stories DB를 확보해 세션에 함께 적는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(200).json({connected: false, pages: [], selected: null});
		return;
	}

	if (req.method === 'POST') {
		// 노션 ID 형식(UUID, 하이픈 유무 무관)만 받는다. 이 값은 그대로 노션 API 경로에
		// 들어가므로 형식이 아닌 것은 요청을 만들기 전에 끊는다. 값은 받은 그대로
		// 저장한다 — 검색 결과의 id와 같은 표기라야 화면이 "현재 저장 위치"를 맞춘다.
		const pageId = String(req.body?.pageId ?? '');

		if (!NOTION_ID.test(pageId)) {
			res.status(400).json({error: 'pageId required'});
			return;
		}

		try {
			res.status(200).json({ok: true, ...(await chooseRoot(s, pageId, res))});
		} catch (error) {
			res.status(502).json({error: (error as Error).message});
		}
		return;
	}

	try {
		res.status(200).json({
			connected: true,
			pages: await searchPages(s.token, s.userId),
			selected: s.rootId ? {rootId: s.rootId} : null
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
