/**
 * 서버 코드라 node 환경에서 돈다.
 *
 * @jest-environment node
 */
import {currentDb, defaultDb} from '../stories-db';
import {ensureStoriesDb, searchPages, searchStoriesDbs} from '../notion';
import {Session} from '../session';

jest.mock('../notion');

const mockEnsure = ensureStoriesDb as jest.MockedFunction<
	typeof ensureStoriesDb
>;
const mockPages = searchPages as jest.MockedFunction<typeof searchPages>;
const mockDbs = searchStoriesDbs as jest.MockedFunction<
	typeof searchStoriesDbs
>;

const session = (props: Partial<Session> = {}): Session => ({
	token: 'tok',
	...props
});

// 저장 위치를 고른 적이 없어도 어딘가로는 저장돼야 한다. 예전에는 여기서 던져서
// 동기화가 조용히 꺼졌고, 스토리가 브라우저에만 남았다.
describe('defaultDb', () => {
	it('이미 있는 stories DB를 쓴다 — 빈 DB를 새로 만들지 않는다', async () => {
		mockDbs.mockResolvedValue([
			{id: 'db-recent', title: 'Twine Stories (창작)'},
			{id: 'db-old', title: 'Twine Stories (회고)'}
		]);

		expect(await defaultDb(session())).toEqual({dbId: 'db-recent'});
		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('stories DB가 없으면 가장 최근에 편집한 공유 페이지 아래에 만든다', async () => {
		mockDbs.mockResolvedValue([]);
		mockPages.mockResolvedValue([
			{id: 'page-recent', title: '최근'},
			{id: 'page-old', title: '예전'}
		]);
		mockEnsure.mockResolvedValue('db-new');

		expect(await defaultDb(session())).toEqual({
			dbId: 'db-new',
			rootId: 'page-recent'
		});
		expect(mockEnsure).toHaveBeenCalledWith('tok', 'page-recent');
	});

	it('공유된 페이지가 하나도 없으면 이유를 담아 던진다', async () => {
		mockDbs.mockResolvedValue([]);
		mockPages.mockResolvedValue([]);

		await expect(defaultDb(session())).rejects.toThrow(
			'공유된 페이지가 없습니다'
		);
	});
});

describe('currentDb', () => {
	it('고른 DB가 있으면 노션을 뒤지지 않는다', async () => {
		expect(await currentDb(session({dbId: 'db-chosen'}))).toBe('db-chosen');
		expect(mockDbs).not.toHaveBeenCalled();
	});

	it('고른 루트가 있으면 그 아래 DB를 쓰고 기본값 탐색을 하지 않는다', async () => {
		mockEnsure.mockResolvedValue('db-under-root');

		const s = session({rootId: 'page-chosen'});

		expect(await currentDb(s)).toBe('db-under-root');
		expect(mockDbs).not.toHaveBeenCalled();
		// 사용자가 고른 루트이므로 기본값 표시가 붙지 않는다.
		expect(s.autoRoot).toBeUndefined();
	});

	it('아무것도 없으면 기본값으로 정하고 기본값이라고 표시해 둔다', async () => {
		mockDbs.mockResolvedValue([{id: 'db-found', title: 'Twine Stories'}]);

		const s = session();

		expect(await currentDb(s)).toBe('db-found');
		expect(s.dbId).toBe('db-found');
		expect(s.autoRoot).toBe(true);
	});
});
