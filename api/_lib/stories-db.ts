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
import {searchStoriesDbs} from './notion';
import {Session, writeSession} from './session';

// 저장 위치를 한 번도 고르지 않았을 때 쓸 DB. **이미 있는 stories DB만 쓴다.**
//
// 예전에는 하나도 못 찾으면 "공유된 페이지 중 가장 최근에 편집한 곳" 아래에 새로
// 만들었다. 그게 DB를 노션 여기저기 흩뿌렸다 — 그때그때 마지막으로 만진 페이지가
// 달라지니, 하루에 빈 "Twine Stories" DB가 두 개 생기고 스토리가 엉뚱한 곳에 쌓였다.
// 위치를 잘못 추측해 만드는 것보다 물어보는 게 낫다. 그래서 못 찾으면 던지고,
// status가 그 이유를 그대로 사용자에게 보여준다.
//
// 새로 만드는 것은 사용자가 저장 위치 화면에서 페이지를 직접 고를 때만 일어난다
// (api/notion-sync/dbs.ts의 POST).
export async function defaultDb(session: Session): Promise<{dbId: string}> {
	const existing = await searchStoriesDbs(session.token);

	if (!existing.length) {
		throw new Error(
			'노션에서 스토리를 저장할 곳을 찾지 못했습니다. "저장 위치"에서 골라 주세요.'
		);
	}

	return {dbId: existing[0].id};
}

// 스토리를 읽고 쓰고 지우는 단 하나의 DB.
export async function currentDb(
	session: Session,
	res?: ServerResponse
): Promise<string> {
	if (session.dbId) return session.dbId;

	const {dbId} = await defaultDb(session);

	remember(session, dbId, res, true);
	return dbId;
}

function remember(
	session: Session,
	dbId: string,
	res?: ServerResponse,
	auto = false
) {
	// 세션에 박아둔다 — 안 남기면 요청마다 노션을 다시 뒤진다.
	session.dbId = dbId;
	if (auto) session.autoRoot = true;

	if (res) writeSession(res, session);
}
