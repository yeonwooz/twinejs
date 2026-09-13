/**
 * 서버 코드라 node 환경에서 돈다.
 *
 * @jest-environment node
 */
import type {ServerResponse} from 'node:http';
import {chooseRoot, currentDb, hasRoot, NO_ROOT_MESSAGE} from '../stories-db';
import {ensureStoriesDb} from '../notion';
import {Session, writeSession} from '../session';

jest.mock('../notion');
jest.mock('../session', () => ({
	...jest.requireActual('../session'),
	writeSession: jest.fn()
}));

const mockEnsure = ensureStoriesDb as jest.MockedFunction<
	typeof ensureStoriesDb
>;
const mockWrite = writeSession as jest.MockedFunction<typeof writeSession>;
const res = {} as ServerResponse;

const session = (props: Partial<Session> = {}): Session => ({
	token: 'tok',
	...props
});

beforeEach(() => {
	mockEnsure.mockReset();
	mockWrite.mockReset();
});

describe('hasRoot', () => {
	it('루트 페이지를 골랐을 때만 참이다', () => {
		expect(hasRoot(session({rootId: 'root'}))).toBe(true);
		expect(hasRoot(session())).toBe(false);
	});

	// 옛 방식으로 루트 없이 고른 DB는 어디 있는지, 누구 것인지 알 수 없다.
	it('루트 없이 DB만 있는 옛 세션은 고른 것으로 치지 않는다', () => {
		expect(hasRoot(session({dbId: 'db-old'}))).toBe(false);
	});
});

describe('chooseRoot', () => {
	it('루트 아래 DB를 확보해 루트와 함께 세션에 적는다', async () => {
		mockEnsure.mockResolvedValue('db-under-root');

		const s = session({dbId: 'db-old'});

		expect(await chooseRoot(s, 'root', res)).toEqual({
			rootId: 'root',
			dbId: 'db-under-root'
		});
		expect(mockEnsure).toHaveBeenCalledWith('tok', 'root');
		expect(s).toMatchObject({
			rootId: 'root',
			dbId: 'db-under-root',
			dbRootId: 'root'
		});
		expect(mockWrite).toHaveBeenCalledWith(res, s);
	});
});

describe('currentDb', () => {
	// 예전에는 여기서 워크스페이스를 뒤져 "가장 최근 Twine Stories DB"를 기본값으로
	// 삼았다. 팀 워크스페이스에서는 그게 남의 DB였다.
	it('루트를 고르지 않았으면 추측하지 않고 고르라고 던진다', async () => {
		await expect(currentDb(session())).rejects.toThrow(NO_ROOT_MESSAGE);
		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('루트와 맞는 DB 캐시가 있으면 노션을 뒤지지 않는다', async () => {
		expect(
			await currentDb(session({rootId: 'root', dbId: 'db', dbRootId: 'root'}))
		).toBe('db');
		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('캐시가 없으면 루트 아래에서 찾아 캐시한다', async () => {
		mockEnsure.mockResolvedValue('db-under-root');

		const s = session({rootId: 'root'});

		expect(await currentDb(s, res)).toBe('db-under-root');
		expect(mockEnsure).toHaveBeenCalledWith('tok', 'root');
		expect(s).toMatchObject({dbId: 'db-under-root', dbRootId: 'root'});
		expect(mockWrite).toHaveBeenCalledWith(res, s);
	});

	// 루트를 바꿨거나, 옛 방식으로 루트와 무관하게 고른 DB가 남아 있는 경우.
	it('캐시가 다른 루트의 것이면 버리고 다시 찾는다', async () => {
		mockEnsure.mockResolvedValue('db-under-new');

		const s = session({rootId: 'new', dbId: 'db-old', dbRootId: 'old'});

		expect(await currentDb(s, res)).toBe('db-under-new');
		expect(s).toMatchObject({dbId: 'db-under-new', dbRootId: 'new'});
	});

	it('어느 루트에서 왔는지 모르는 옛 dbId도 다시 찾는다', async () => {
		mockEnsure.mockResolvedValue('db-under-root');

		expect(await currentDb(session({rootId: 'root', dbId: 'db-old'}))).toBe(
			'db-under-root'
		);
		expect(mockEnsure).toHaveBeenCalledWith('tok', 'root');
	});

	it('응답 객체가 없으면 세션 쿠키를 쓰지 않는다', async () => {
		mockEnsure.mockResolvedValue('db');
		await currentDb(session({rootId: 'root'}));
		expect(mockWrite).not.toHaveBeenCalled();
	});
});
