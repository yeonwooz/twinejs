/**
 * 서버 코드라 node 환경에서 돈다.
 *
 * @jest-environment node
 */
import handler from '../status';
import {getSession} from '../../_lib/session';
import {currentDb} from '../../_lib/stories-db';

jest.mock('../../_lib/session');
jest.mock('../../_lib/stories-db');

const mockSession = getSession as jest.MockedFunction<typeof getSession>;
const mockCurrentDb = currentDb as jest.MockedFunction<typeof currentDb>;

function run(session: Record<string, unknown> | null) {
	mockSession.mockReturnValue(session as any);

	const res = {
		status: jest.fn().mockReturnThis(),
		json: jest.fn()
	};

	return handler({} as any, res as any).then(() => res.json.mock.calls[0][0]);
}

describe('GET /__notion-sync/status', () => {
	beforeEach(() => {
		mockCurrentDb.mockReset();
	});

	it('미연결이면 전부 꺼진 채로 200을 준다', async () => {
		// 폴링이 안전하게 찔러볼 수 있어야 해서 401을 내지 않는다.
		expect(await run(null)).toMatchObject({connected: false, enabled: false});
	});

	// 저장할 곳은 둘이다 -- 초안이 갈 페이지(rootId)와 twee가 갈 DB(dbId).
	// 예전에는 chosen이 dbId만 봤고, 초안 생성은 rootId를 요구했다. 그래서 루트 없는
	// 사용자는 아무것도 안 물어보다가 [만들기]에서야 막혔다. 그동안 헤더는
	// "노션에 저장됨"이라고 말하고 있었다.
	it('DB만 있고 루트가 없으면 아직 다 고른 게 아니다', async () => {
		expect(await run({token: 't', dbId: 'db-a'})).toMatchObject({
			chosen: false,
			// 동기화 자체는 돈다 -- 루트가 없어도 스토리는 저장된다.
			enabled: true,
			rootId: null
		});
	});

	it('둘 다 있고 사용자가 직접 골랐으면 다 정해진 것이다', async () => {
		expect(
			await run({token: 't', dbId: 'db-a', rootId: 'page-1'})
		).toMatchObject({chosen: true, enabled: true, rootId: 'page-1'});
	});

	// 앱이 정한 기본값은 고른 것으로 세지 않는다 -- 어디에 쌓이는지는 알려줘야 한다.
	it('앱이 기본값으로 정한 것이면 고른 것으로 치지 않는다', async () => {
		expect(
			await run({token: 't', dbId: 'db-a', rootId: 'page-1', autoRoot: true})
		).toMatchObject({chosen: false});
	});

	// 켜졌다고 믿고 쓰는 것이 이 앱의 가장 큰 사고였다.
	it('기본값조차 못 정하면 이유를 붙여 꺼졌다고 말한다', async () => {
		mockCurrentDb.mockRejectedValue(new Error('공유된 페이지가 없습니다.'));

		expect(await run({token: 't'})).toMatchObject({
			connected: true,
			enabled: false,
			error: '공유된 페이지가 없습니다.'
		});
	});
});
