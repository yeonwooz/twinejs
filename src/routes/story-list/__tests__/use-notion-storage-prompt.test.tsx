import {render, waitFor} from '@testing-library/react';
import * as React from 'react';
import {useDialogsContext} from '../../../dialogs';
import {useNotionStoragePrompt} from '../use-notion-storage-prompt';

jest.mock('../../../dialogs', () => ({
	...jest.requireActual('../../../dialogs'),
	useDialogsContext: jest.fn()
}));

const Harness: React.FC = () => {
	useNotionStoragePrompt();
	return null;
};

describe('useNotionStoragePrompt', () => {
	function mockStatus(status: unknown) {
		(global as any).fetch = jest.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => status
		}));
	}

	function renderHarness() {
		const dispatch = jest.fn();

		(useDialogsContext as jest.Mock).mockReturnValue({dispatch, dialogs: []});
		render(<Harness />);
		return dispatch;
	}

	beforeEach(() => window.localStorage.clear());

	it('연결은 했는데 저장 위치를 안 골랐으면 물어본다', async () => {
		mockStatus({connected: true, chosen: false, enabled: false});

		const dispatch = renderHarness();

		await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
	});

	it('이미 고른 사용자는 방해하지 않는다', async () => {
		mockStatus({connected: true, chosen: true, enabled: true});

		const dispatch = renderHarness();

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(dispatch).not.toHaveBeenCalled();
	});

	// dev 서버 미들웨어는 connected/chosen을 주지 않는다 — .env.local이 정하므로.
	it('저장 위치를 서버가 정하는 환경에서는 뜨지 않는다', async () => {
		mockStatus({enabled: true});

		const dispatch = renderHarness();

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('한 번 물어본 뒤로는 다시 묻지 않는다', async () => {
		mockStatus({connected: true, chosen: false, enabled: false});

		const first = renderHarness();

		await waitFor(() => expect(first).toHaveBeenCalledTimes(1));

		const second = renderHarness();

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(second).not.toHaveBeenCalled();
	});

	it('상태를 못 물어보면 조용히 넘어간다', async () => {
		(global as any).fetch = jest.fn(async () => {
			throw new Error('offline');
		});

		const dispatch = renderHarness();

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(dispatch).not.toHaveBeenCalled();
	});
});
