import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {currentDb} from '../_lib/stories-db';

// 클라 notion-sync가 sync 활성 여부를 판단하는 엔드포인트.
//
// 저장 위치를 고른 적이 없으면 여기서 기본값을 정해 세션에 박는다. 예전에는 고르기
// 전까지 enabled가 false여서, 시나리오는 만들어지는데(생성은 연결만 요구한다)
// 동기화만 조용히 꺼진 채로 스토리가 브라우저에만 남았다. 기본값 결정은 노션을
// 뒤지는 일이라 값이 싸지 않지만, 세션에 남으므로 연결당 한 번뿐이다.
//
// 기본값조차 못 정하면(공유된 페이지가 없는 경우) enabled를 false로 정직하게 알리고
// 이유를 붙인다 — 켜졌다고 믿고 쓰는 것이 이 앱의 가장 큰 사고였다.
//
// chosen: 사용자가 저장 위치를 직접 고른 적이 있나. false면 클라가 한 번 물어본다.
// 앱이 정한 기본값(autoRoot)은 고른 것으로 세지 않는다 — 어디에 쌓이는지는 알려줘야
// 한다. dev 서버 미들웨어는 이 필드를 주지 않는다(.env가 정하므로 물을 게 없다).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(200).json({connected: false, enabled: false, chosen: false});
		return;
	}

	if (!s.dbId && !s.rootId) {
		try {
			await currentDb(s, res);
		} catch (error) {
			res.status(200).json({
				connected: true,
				enabled: false,
				chosen: false,
				error: (error as Error).message
			});
			return;
		}
	}

	res.status(200).json({
		connected: true,
		enabled: !!(s.dbId || s.rootId),
		chosen: !!s.dbId && !s.autoRoot
	});
}
