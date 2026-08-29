// stories DB 해석. 규칙은 하나 — 위저드에서 고른 루트 페이지 아래의 stories DB를
// 쓴다. 회고든 창작 시나리오든 같은 루트를 골랐으면 같은 DB에 들어간다.
//
// 고른 적이 없어도 어딘가로는 저장돼야 한다. 시나리오 생성은 노션 연결만 요구하므로
// (api/translate.ts) 저장 위치를 고르지 않은 채 스토리를 만들 수 있는데, 예전에는 그때
// 동기화가 조용히 꺼져 브라우저에만 남았다. 그래서 아래 defaultRoot로 기본값을 정한다.
import type {ServerResponse} from 'node:http';
import {
	ensureStoriesDb,
	findStoriesDb,
	searchPages,
	searchStoriesDbs,
	storyExistsIn
} from './notion';
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

// 새 스토리를 쓸 DB. 루트를 골랐으면 그 아래에서 찾고(없으면 만들고), 고른 적이
// 없으면 기본값으로 정한다.
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

// 읽기·삭제 대상 DB 전부. 루트를 바꿔가며 쓰면(회고는 회고 루트, 시나리오는 시나리오
// 루트) 예전 루트의 스토리도 계속 보여야 한다. 현재 DB만 읽으면 나머지가 "원격에서
// 사라진 것"으로 보여 로컬에서도 지워진다 — 되돌릴 수 없는 쪽이라 넉넉하게 읽는다.
export async function allDbs(
	session: Session,
	res?: ServerResponse,
	{discover = true}: {discover?: boolean} = {}
): Promise<string[]> {
	const known = session.dbIds ?? (session.dbId ? [session.dbId] : []);

	if (known.length > 0 || !session.rootId || !discover) {
		return known;
	}

	// 세션에 아직 아무것도 없을 때만 노션을 뒤진다(만들지는 않는다). 5초마다 도는
	// 폴링이 매번 탐색하지 않도록 결과는 세션에 캐시한다.
	const found = await findStoriesDb(session.token, session.rootId);

	if (!found) return [];

	remember(session, found, res);
	return [found];
}

// 저장할 DB. 이미 어딘가에 있는 스토리는 그 자리에서 갱신한다 — 안 그러면 예전
// 루트에서 불러온 스토리를 고칠 때 지금 루트의 DB에 복사본이 생긴다.
export async function homeDb(
	session: Session,
	storyId: string,
	res?: ServerResponse
): Promise<string> {
	const known = await allDbs(session, res);

	if (known.length > 1) {
		for (const dbId of known) {
			if (await storyExistsIn(session.token, dbId, storyId)) return dbId;
		}
	}

	return currentDb(session, res);
}

function remember(
	session: Session,
	dbId: string,
	res?: ServerResponse,
	rootId?: string,
	auto = false
) {
	const dbIds = [...new Set([dbId, ...(session.dbIds ?? [])])];

	session.dbId = dbId;
	session.dbIds = dbIds;
	// 기본값으로 정한 루트도 남긴다 — 안 남기면 매 요청마다 페이지를 다시 뒤진다.
	if (rootId) session.rootId = rootId;
	if (auto) session.autoRoot = true;

	if (res) writeSession(res, session);
}
