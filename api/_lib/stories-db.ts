// stories DB 해석. 규칙은 하나 — 스토리는 **한 곳**에만 저장한다. 회고든 창작
// 시나리오든 같은 DB에 들어간다.
//
// 예전에는 "저장할 DB 하나 + 읽어올 DB 여럿"이었다. 루트를 나눠 쓰는 사람을 위한
// 구조였는데, 고르는 화면이 어려워지고 스토리가 노션 여기저기 흩어졌다. 한 곳으로
// 줄이면 고를 것도 하나고, 어디에 있는지 헷갈릴 일이 없다.
//
// 고른 적이 없어도 어딘가로는 저장돼야 한다. 시나리오 생성은 노션 연결만 요구하므로
// (api/translate.ts) 저장 위치를 고르지 않은 채 스토리를 만들 수 있는데, 예전에는 그때
// 동기화가 조용히 꺼져 브라우저에만 남았다. 그래서 아래 defaultDb로 기본값을 정한다.
import type {ServerResponse} from 'node:http';
import {ensureStoriesDb, searchPages, searchStoriesDbs} from './notion';
import {Session, writeSession} from './session';

// 저장 위치를 한 번도 고르지 않았을 때 쓸 DB.
//
// 이미 있는 stories DB를 먼저 쓴다 — 새로 만들면 예전 스토리가 안 보이는 빈 DB로
// 시작하게 되고, 이 저장소에는 그렇게 생긴 빈 껍데기 DB가 이미 쌓인 적이 있다.
// 여러 개면 가장 최근에 쓴 것(노션 검색 순서)으로 간다. 하나도 없을 때만 공유된
// 페이지 중 가장 최근에 편집한 곳 아래에 만든다.
//
// 이건 어디까지나 기본값이다. 사용자가 직접 고른 적이 없다는 사실은 세션에
// autoRoot로 남고, 홈에서 저장 위치를 한 번 알려준다.
export async function defaultDb(
	session: Session
): Promise<{dbId: string; rootId?: string}> {
	const existing = await searchStoriesDbs(session.token);

	if (existing.length) return {dbId: existing[0].id};

	const pages = await searchPages(session.token);

	if (!pages.length) {
		throw new Error(
			'노션에 공유된 페이지가 없습니다. 통합에 페이지를 하나 연결해 주세요.'
		);
	}

	return {
		dbId: await ensureStoriesDb(session.token, pages[0].id),
		rootId: pages[0].id
	};
}

// 스토리를 읽고 쓰고 지우는 단 하나의 DB. 루트를 골랐으면 그 아래에서 찾고(없으면
// 만들고), 고른 적이 없으면 기본값으로 정한다.
export async function currentDb(
	session: Session,
	res?: ServerResponse
): Promise<string> {
	if (session.dbId) return session.dbId;

	if (session.rootId) {
		const dbId = await ensureStoriesDb(session.token, session.rootId);

		remember(session, dbId, res);
		return dbId;
	}

	const {dbId, rootId} = await defaultDb(session);

	remember(session, dbId, res, rootId, true);
	return dbId;
}

function remember(
	session: Session,
	dbId: string,
	res?: ServerResponse,
	rootId?: string,
	auto = false
) {
	session.dbId = dbId;
	// 기본값으로 정한 루트도 남긴다 — 안 남기면 매 요청마다 페이지를 다시 뒤진다.
	if (rootId) session.rootId = rootId;
	if (auto) session.autoRoot = true;

	if (res) writeSession(res, session);
}
