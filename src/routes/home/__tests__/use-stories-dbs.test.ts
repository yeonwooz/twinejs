import {waitFor} from '@testing-library/react';
import {renderHook} from '@testing-library/react-hooks';
import {forgetStoriesDbs, useStoriesDbs} from '../use-stories-dbs';

const INFO = {
	connected: true,
	options: [{id: 'db-a', title: '회고 스토리'}],
	selected: {dbId: 'db-a'}
};

function mockDbs(ok: boolean) {
	(global as any).fetch = jest.fn(async (): Promise<any> => ({
		ok,
		status: ok ? 200 : 502,
		headers: {get: () => 'application/json'},
		json: async () => (ok ? INFO : {error: 'fetch failed'})
	}));

	return (global as any).fetch as jest.Mock;
}

describe('useStoriesDbs', () => {
	beforeEach(() => forgetStoriesDbs());

	it('목록을 받아오면 DB와 기본값을 준다', async () => {
		mockDbs(true);

		const {result} = renderHook(() => useStoriesDbs());

		await waitFor(() => expect(result.current.dbs).toHaveLength(1));
		expect(result.current).toMatchObject({connected: true, defaultDbId: 'db-a'});
		expect(result.current.failed).toBeFalsy();
	});

	// 못 불러온 것과 미연결은 다른 말이다. 섞으면 헤더는 "노션에 저장됨"인데 줄마다는
	// "노션 연결 안 됨"이라고 하는 꼴이 된다.
	it('못 불러오면 failed로 표시한다', async () => {
		mockDbs(false);

		const {result} = renderHook(() => useStoriesDbs());

		await waitFor(() => expect(result.current.failed).toBe(true));
	});

	// 회귀: 실패를 캐시했더니 로드 때 네트워크가 한 번 끊긴 것만으로 새로고침 전까지
	// 모든 줄이 "노션 연결 안 됨"에 갇혔다.
	it('실패는 캐시하지 않아 다음 조회에서 다시 받아온다', async () => {
		mockDbs(false);

		const first = renderHook(() => useStoriesDbs());

		await waitFor(() => expect(first.result.current.failed).toBe(true));

		mockDbs(true);

		const second = renderHook(() => useStoriesDbs());

		await waitFor(() => expect(second.result.current.dbs).toHaveLength(1));
	});

	it('성공은 캐시해서 줄마다 다시 묻지 않는다', async () => {
		const fetchMock = mockDbs(true);
		const {result} = renderHook(() => useStoriesDbs());

		await waitFor(() => expect(result.current.dbs).toHaveLength(1));
		renderHook(() => useStoriesDbs());
		renderHook(() => useStoriesDbs());

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retry로 실패한 목록을 다시 받아온다', async () => {
		mockDbs(false);

		const {result} = renderHook(() => useStoriesDbs());

		await waitFor(() => expect(result.current.failed).toBe(true));
		mockDbs(true);
		result.current.retry();

		await waitFor(() => expect(result.current.dbs).toHaveLength(1));
	});
});
