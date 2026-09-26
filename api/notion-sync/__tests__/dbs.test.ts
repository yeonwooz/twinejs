/**
 * 서버 코드라 node 환경에서 돈다.
 *
 * @jest-environment node
 */
import handler from '../dbs';
import {getSession} from '../../_lib/session';
import {searchPages, searchStoriesDbs} from '../../_lib/notion';

jest.mock('../../_lib/session');
jest.mock('../../_lib/notion', () => ({
	...jest.requireActual('../../_lib/notion'),
	searchPages: jest.fn(),
	searchStoriesDbs: jest.fn(),
	ensureStoriesDb: jest.fn()
}));

const mockSession = getSession as jest.MockedFunction<typeof getSession>;
const mockPages = searchPages as jest.MockedFunction<typeof searchPages>;
const mockDbs = searchStoriesDbs as jest.MockedFunction<
	typeof searchStoriesDbs
>;

// 노션 API가 주는 형태 -- 대시 있음.
const PAGES = [
	{id: '3a0bb67c-a90c-80ae-8f1b-f170c83fa13f', title: '회고 루트'}
];
const DBS = [
	{id: '393bb67c-a90c-81d3-a361-db89402adcb2', title: 'Twine Stories'}
];

function get(session: Record<string, unknown>) {
	mockSession.mockReturnValue(session as any);
	mockPages.mockResolvedValue(PAGES as any);
	mockDbs.mockResolvedValue(DBS as any);

	const res = {status: jest.fn().mockReturnThis(), json: jest.fn()};

	return handler({method: 'GET'} as any, res as any).then(
		() => res.json.mock.calls[0][0]
	);
}

describe('GET /api/notion-sync/dbs', () => {
	// 회귀: 노션 id는 대시 있는 형태(API)와 없는 형태(URL에서 뽑아 .env.local에 적는 것)가
	// 섞인다. 세션에 대시 없는 rootId가 들어 있으면 화면의 라디오가 영영 안 맞아서,
	// 분명히 정해져 있는데도 아무것도 안 고른 것처럼 보였다.
	it('대시 없는 id도 목록의 같은 항목으로 맞춰 준다', async () => {
		const body = await get({
			token: 't',
			rootId: '3a0bb67ca90c80ae8f1bf170c83fa13f',
			dbId: '393bb67ca90c81d3a361db89402adcb2'
		});

		expect(body.selected).toEqual({
			rootId: '3a0bb67c-a90c-80ae-8f1b-f170c83fa13f',
			dbId: '393bb67c-a90c-81d3-a361-db89402adcb2'
		});
	});

	it('이미 맞는 형태면 그대로 둔다', async () => {
		const body = await get({token: 't', rootId: PAGES[0].id, dbId: DBS[0].id});

		expect(body.selected).toEqual({rootId: PAGES[0].id, dbId: DBS[0].id});
	});

	// 목록에 없는 곳을 가리키고 있다는 사실 자체가 정보다 -- 숨기지 않는다.
	it('목록에 없는 id는 그대로 돌려준다', async () => {
		const body = await get({token: 't', rootId: 'page-gone', dbId: DBS[0].id});

		expect(body.selected.rootId).toBe('page-gone');
	});

	it('미연결이면 401 대신 connected:false를 준다', async () => {
		mockSession.mockReturnValue(null);

		const res = {status: jest.fn().mockReturnThis(), json: jest.fn()};

		await handler({method: 'GET'} as any, res as any);
		expect(res.json.mock.calls[0][0]).toMatchObject({connected: false});
	});
});
