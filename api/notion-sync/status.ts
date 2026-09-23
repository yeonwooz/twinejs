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
// chosen: 저장할 곳이 **다** 정해졌나. false면 클라가 한 번 물어본다.
//
// 저장할 곳은 둘이다 — 초안 원고가 갈 페이지(rootId)와 twee가 갈 DB(dbId). 예전에는
// 여기서 dbId만 봤는데, 초안 생성(api/notion/retros.ts)은 rootId를 요구한다. 그래서
// dbId만 있는 사용자는 "다 정해졌다"로 분류돼 아무것도 안 물어보다가, 작문대에서
// [만들기]를 누르는 순간에야 "초안을 담아 둘 노션 페이지가 정해지지 않았습니다"로
// 막혔다. 헤더 표시등은 그동안 "노션에 저장됨"이라고 말하고 있었다(sync는 dbId만
// 있으면 되니까). 둘이 어긋나면 안 된다.
//
// enabled는 그대로 dbId 기준이다 — 루트가 없어도 스토리 동기화 자체는 돈다.
// 앱이 정한 기본값(autoRoot)은 고른 것으로 세지 않는다 — 어디에 쌓이는지는 알려줘야
// 한다. dev 서버 미들웨어는 이 필드를 주지 않는다(.env가 정하므로 물을 게 없다).
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);

	if (!s?.token) {
		res.status(200).json({
			chosen: false,
			connected: false,
			dbId: null,
			enabled: false,
			rootId: null
		});
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

	// dbId까지 알려주는 건 홈이 스토리별로 "이건 다른 곳에 저장돼 있다"를 말하기 위해서다.
	// 클라는 마지막으로 어느 DB에서 봤는지를 장부에 적어 두므로, 지금 DB와 비교할 수 있다.
	res.status(200).json({
		connected: true,
		dbId: s.dbId ?? null,
		enabled: !!(s.dbId || s.rootId),
		rootId: s.rootId ?? null,
		chosen: !!s.dbId && !!s.rootId && !s.autoRoot
	});
}
