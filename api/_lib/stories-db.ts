// 저장 위치 해석. 규칙은 하나 — **사용자가 고른 페이지(rootId) 하나** 아래에 전부 둔다.
//
//   <고른 페이지>
//   ├─ N주차 회고 …      회고 초안 (api/notion/retros.ts, kind=retro)
//   ├─ 시나리오/          시나리오 초안 (kind=scenario)
//   ├─ 스토리/            일반 스토리 구상 (kind=story)
//   └─ Twine Stories      twee 스토리 DB (ensureStoriesDb)
//
// 세션이 기억하는 선택은 rootId뿐이다. dbId는 그 아래에서 찾은 결과의 캐시이고, 루트가
// 바뀌면 같이 버린다(dbRootId로 판별).
//
// 왜 이렇게까지 좁히나. 예전에는 (1) 루트와 DB를 따로 고를 수 있어 둘이 무관한 곳을
// 가리켰고, (2) 고르지 않은 사용자에게는 워크스페이스 검색으로 "가장 최근에 편집한
// Twine Stories DB"를 기본값으로 박았다. 공개 통합은 워크스페이스당 봇이 하나라 그
// 검색에는 **다른 사람이 공유한 DB도 나온다** — 그래서 팀 워크스페이스에서는 모두가
// 같은(남의) DB에 저장하고 서로의 스토리를 받아갔다. 기본값 추측을 없애고, 루트에서
// DB를 유도하면 두 문제가 한 번에 사라진다: 자기 페이지를 고른 사람은 자기 DB를 쓰고,
// DB는 늘 그 페이지 아래 한 곳에 있다.
import type {ServerResponse} from 'node:http';
import {ensureStoriesDb} from './notion';
import {Session, writeSession} from './session';

export const NO_ROOT_MESSAGE =
	'스토리를 저장할 노션 페이지가 아직 정해지지 않았습니다. "저장 위치"에서 골라 주세요.';

// 저장 위치가 정해졌나. 옛 세션의 dbId(루트 없이 고른 DB)는 선택으로 치지 않는다 —
// 그 DB가 어디 있는지, 누구 것인지 알 수 없다.
export function hasRoot(session: Session): session is Session & {rootId: string} {
	return !!session.rootId;
}

// 루트를 고른다. 그 아래에 stories DB를 확보해(있으면 그것, 없으면 생성) 세션에 함께
// 적는다. DB를 만드는 곳은 여기뿐이다 — 읽기 경로에서 만들면 화면을 여는 것만으로
// 빈 DB가 생기던 적이 있다.
export async function chooseRoot(
	session: Session,
	rootId: string,
	res: ServerResponse
): Promise<{rootId: string; dbId: string}> {
	const dbId = await ensureStoriesDb(session.token, rootId);

	session.rootId = rootId;
	session.dbId = dbId;
	session.dbRootId = rootId;
	writeSession(res, session);

	return {rootId, dbId};
}

// 스토리를 읽고 쓰고 지우는 단 하나의 DB. 캐시가 루트와 맞으면 그대로, 아니면 루트
// 아래에서 다시 찾아 캐시한다.
//
// 캐시가 비어 있을 때도 ensureStoriesDb를 부르므로 DB가 없으면 만들어진다 — 다만 항상
// 사용자가 고른 루트 아래이고, chooseRoot가 이미 만들어 둔 것이 정상 경로라 실제로는
// 루트만 있고 DB 캐시가 없는 옛 세션에서만 일어난다.
export async function currentDb(
	session: Session,
	res?: ServerResponse
): Promise<string> {
	if (!hasRoot(session)) {
		throw new Error(NO_ROOT_MESSAGE);
	}

	if (session.dbId && session.dbRootId === session.rootId) {
		return session.dbId;
	}

	const dbId = await ensureStoriesDb(session.token, session.rootId);

	session.dbId = dbId;
	session.dbRootId = session.rootId;

	if (res) {
		writeSession(res, session);
	}

	return dbId;
}
