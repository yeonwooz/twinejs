// stories DB 해석.
//
// **기본 저장 위치는 하나**(세션의 dbId)이고, 스토리는 따로 지정하지 않는 한 거기 들어간다.
// 다만 스토리별로 다른 DB를 고를 수 있다 — 홈 목록의 각 줄에서 고른다.
//
// 예전에 이걸 걷어낸 적이 있다. 그때 문제는 여러 DB 자체가 아니라 **고르는 화면**이었다:
// 설정 한 곳에 "저장할 DB / 읽어올 DB 여럿 / 새로 만들기"가 세 덩어리로 쌓여 무슨
// 선택인지 알 수 없었다. 줄마다 고르는 지금 방식은 "이 스토리가 어디 있나"가 그 줄에
// 적혀 있으므로 같은 함정이 아니다.
//
// 안전장치는 그대로 살아 있다: 목록 응답의 각 행에 dbId가 붙고, 클라는 **이번에 실제로
// 읽은 DB**에 속한 것만 "원격에서 삭제됨" 후보로 본다(remotelyDeletedStoryIds).
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

// 한 번에 읽을 DB 수 상한. 폴링이 5초마다 DB마다 한 번씩 노션을 찌르므로, 늘어나면
// 레이트 리밋(평균 3 req/s)에 걸린다. 넘치면 앞에서부터 자른다.
export const MAX_READ_DBS = 8;

/**
 * 쓰기·삭제가 실제로 향할 DB.
 *
 * `?db=`로 지정됐으면 그걸 쓰되, **정말 이 통합이 볼 수 있는 stories DB인지 확인한다.**
 * 확인 없이 받으면 오타 하나로 스토리가 아무 데도 안 가거나 엉뚱한 DB에 쌓인다 — 이미
 * 한 번 겪은 사고다. 지정이 없으면 기본 저장 위치로 떨어진다.
 */
export async function targetDb(
	session: Session,
	requested: string | undefined,
	res?: ServerResponse
): Promise<string> {
	if (!requested) {
		return currentDb(session, res);
	}

	const known = await searchStoriesDbs(session.token);

	if (!known.some((db: {id: string}) => db.id === requested)) {
		throw new Error(
			'그 DB를 찾을 수 없습니다. 노션에서 통합에 공유돼 있는지 확인해 주세요.'
		);
	}

	return requested;
}

/**
 * 읽어올 DB들. 기본 저장 위치에, 스토리별로 따로 지정된 DB들을 더한다.
 *
 * 클라가 `?db=a,b,c`로 알려준다 — 어느 스토리가 어디 있는지는 클라의 장부에만 있다.
 * 서버는 세션에 그걸 담아두지 않는다(쿠키에 목록을 쌓으면 금방 넘친다).
 */
export async function readDbs(
	session: Session,
	requested: string | undefined,
	res?: ServerResponse
): Promise<string[]> {
	const base = await currentDb(session, res);
	const extra = (requested ?? '')
		.split(',')
		.map(id => id.trim())
		.filter(id => id && id !== base);

	return [base, ...new Set(extra)].slice(0, MAX_READ_DBS);
}

// 기본 저장 위치. 스토리가 따로 지정하지 않았으면 여기로 간다.
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
