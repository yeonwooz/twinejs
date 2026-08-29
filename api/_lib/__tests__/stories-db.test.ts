/**
 * 서버 코드라 node 환경에서 돈다.
 *
 * @jest-environment node
 */
import {currentDb, defaultDb} from '../stories-db';
import {searchStoriesDbs} from '../notion';
import {Session} from '../session';

jest.mock('../notion');

const mockDbs = searchStoriesDbs as jest.MockedFunction<
	typeof searchStoriesDbs
>;

const session = (props: Partial<Session> = {}): Session => ({
	token: 'tok',
	...props
});

// 저장 위치를 고른 적이 없어도 어딘가로는 저장돼야 한다. 예전에는 그때 동기화가
// 조용히 꺼졌고, 스토리가 브라우저에만 남았다.
describe('defaultDb', () => {
	it('이미 있는 stories DB 중 가장 최근 것을 쓴다', async () => {
		mockDbs.mockResolvedValue([
			{id: 'db-recent', title: 'Twine Stories (창작)'},
			{id: 'db-old', title: 'Twine Stories (회고)'}
		]);

		expect(await defaultDb(session())).toEqual({dbId: 'db-recent'});
	});

	// 위치를 추측해 만들면 그때그때 다른 페이지 아래에 빈 DB가 생기고 스토리가
	// 흩어진다. 만드는 대신 이유를 담아 던지고, 사용자가 고르게 한다.
	it('stories DB가 없으면 만들지 않고 고르라고 던진다', async () => {
		mockDbs.mockResolvedValue([]);

		await expect(defaultDb(session())).rejects.toThrow('"저장 위치"에서 골라');
	});
});

describe('currentDb', () => {
	it('고른 DB가 있으면 노션을 뒤지지 않는다', async () => {
		expect(await currentDb(session({dbId: 'db-chosen'}))).toBe('db-chosen');
		expect(mockDbs).not.toHaveBeenCalled();
	});

	it('없으면 기본값으로 정하고 기본값이라고 표시해 둔다', async () => {
		mockDbs.mockResolvedValue([{id: 'db-found', title: 'Twine Stories'}]);

		const s = session();

		expect(await currentDb(s)).toBe('db-found');
		expect(s.dbId).toBe('db-found');
		expect(s.autoRoot).toBe(true);
	});

	it('고를 곳이 없으면 그대로 실패한다 — 아무 곳에나 만들지 않는다', async () => {
		mockDbs.mockResolvedValue([]);

		await expect(currentDb(session())).rejects.toThrow('찾지 못했습니다');
	});
});
