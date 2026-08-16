// stories DB 해석. 규칙은 하나 — 위저드에서 고른 루트 페이지 아래의 stories DB를
// 쓴다. 회고든 창작 시나리오든 같은 루트를 골랐으면 같은 DB에 들어간다.
import type {ServerResponse} from 'node:http';
import {ensureStoriesDb, findStoriesDb, storyExistsIn} from './notion';
import {Session, writeSession} from './session';

// 새 스토리를 쓸 DB(현재 루트). 없으면 루트 아래에서 찾고, 그래도 없으면 만든다.
export async function currentDb(
	session: Session,
	res?: ServerResponse
): Promise<string> {
	if (session.dbId) return session.dbId;

	if (!session.rootId) {
		throw new Error('노션 루트 페이지가 아직 선택되지 않았습니다.');
	}

	const dbId = await ensureStoriesDb(session.token, session.rootId);

	remember(session, dbId, res);
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

function remember(session: Session, dbId: string, res?: ServerResponse) {
	const dbIds = [...new Set([dbId, ...(session.dbIds ?? [])])];

	session.dbId = dbId;
	session.dbIds = dbIds;

	if (res) writeSession(res, session);
}
