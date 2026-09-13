import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {axe} from 'jest-axe';
import * as React from 'react';
import {DialogComponentProps} from '../../dialogs.types';
import {NotionStorageDialog} from '../notion-storage-dialog';

jest.mock('../../../store/persistence/notion-sync/use-sync-status', () => ({
	useSyncStatus: () => ({connected: true, enabled: true, failing: false})
}));

const INFO = {
	connected: true,
	pages: [
		{id: 'page-1', title: '스터디', mine: true},
		{id: 'page-2', title: '팀 회고', mine: false}
	],
	selected: {rootId: 'page-1'}
};

function mockApi(info: unknown = INFO, post: unknown = {ok: true}) {
	const fetchMock = jest.fn(async (_url: string, opts?: RequestInit) => ({
		ok: true,
		status: 200,
		json: async () => (opts?.method === 'POST' ? post : info)
	}));

	(global as any).fetch = fetchMock;
	return fetchMock;
}

function postOf(fetchMock: jest.Mock) {
	const call = fetchMock.mock.calls.find(
		([, opts]) => (opts as RequestInit)?.method === 'POST'
	);

	return call
		? {url: call[0], body: JSON.parse(String((call[1] as RequestInit).body))}
		: undefined;
}

describe('<NotionStorageDialog>', () => {
	function renderComponent(props?: Partial<DialogComponentProps>) {
		return render(
			<NotionStorageDialog
				collapsed={false}
				onChangeCollapsed={jest.fn()}
				onChangeHighlighted={jest.fn()}
				onChangeMaximized={jest.fn()}
				onChangeProps={jest.fn()}
				onClose={jest.fn()}
				{...props}
			/>
		);
	}

	// 새 컴퓨터에서 이 화면으로 먼저 들어오면 연결할 길이 없었다. 연결 링크가
	// 회고/시나리오 위저드 안에만 있었기 때문이다.
	it('연결이 안 됐으면 연결 버튼을 준다', async () => {
		mockApi({connected: false, pages: [], selected: null});
		renderComponent();

		expect(await screen.findByText('노션 연결하기')).toBeInTheDocument();
		expect(screen.queryByText('여기에 저장하기')).toBeNull();
	});

	// 고르는 것은 페이지 하나다. 초안도 DB도 그 아래에 정해진 모양으로 들어간다.
	it('페이지 하나만 고르게 하고, 그 아래 배치를 보여준다', async () => {
		mockApi();
		renderComponent();

		expect(await screen.findByText('저장할 페이지')).toBeInTheDocument();
		expect(screen.getAllByRole('radio')).toHaveLength(2);
		expect(
			screen.getByRole('radio', {name: /스터디/, checked: true})
		).toBeInTheDocument();
		expect(screen.getByText(/Twine Stories \(DB\)/)).toBeInTheDocument();
		expect(screen.getByText(/시나리오\//)).toBeInTheDocument();
	});

	// 저장 위치를 고르는 길은 위저드와 같은 하나여야 한다 — 둘이 다른 것을 세션에
	// 적던 것이 위치가 뒤죽박죽이 된 원인이었다.
	it('페이지를 바꾸면 루트 엔드포인트에 pageId를 보낸다', async () => {
		const fetchMock = mockApi();
		const onClose = jest.fn();

		renderComponent({onClose});
		await screen.findByText('저장할 페이지');
		await userEvent.click(screen.getByRole('radio', {name: /팀 회고/}));
		await userEvent.click(screen.getByText('여기에 저장하기'));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(postOf(fetchMock)).toEqual({
			url: '/api/notion/root',
			body: {pageId: 'page-2'}
		});
	});

	// 같은 워크스페이스를 여럿이 쓰면 남이 공유한 페이지도 섞여 나온다. 자기 것을
	// 표시해 주고, 같은 페이지를 고르면 스토리를 함께 본다는 것을 알린다.
	it('내가 만든 페이지를 표시하고 공유 워크스페이스 안내를 붙인다', async () => {
		mockApi();
		renderComponent();
		await screen.findByText('저장할 페이지');

		expect(screen.getByText('내가 만든 페이지')).toBeInTheDocument();
		expect(
			screen.getByText(/같은 페이지를 고른 사람끼리는 스토리를 함께/)
		).toBeInTheDocument();
	});

	it('전부 내 페이지면 공유 워크스페이스 안내를 붙이지 않는다', async () => {
		mockApi({
			...INFO,
			pages: INFO.pages.map(p => ({...p, mine: true}))
		});
		renderComponent();
		await screen.findByText('저장할 페이지');

		expect(screen.queryByText(/같은 페이지를 고른 사람끼리는/)).toBeNull();
	});

	it('공유된 페이지가 없으면 다시 연결하라고 안내한다', async () => {
		mockApi({connected: true, pages: [], selected: null});
		renderComponent();

		expect(
			await screen.findByText(/공유된 페이지가 없습니다/)
		).toBeInTheDocument();
	});

	it('바꾼 게 없으면 저장 버튼이 눌리지 않는다', async () => {
		mockApi();
		renderComponent();
		await screen.findByText('저장할 페이지');

		expect(
			screen.getByText('여기에 저장하기').closest('button')
		).toBeDisabled();
	});

	it('불러오기에 실패하면 이유를 보여준다', async () => {
		(global as any).fetch = jest.fn(async () => ({
			ok: false,
			status: 502,
			json: async () => ({error: '노션에 연결하지 못했어요.'})
		}));

		renderComponent();
		expect(
			await screen.findByText('노션에 연결하지 못했어요.')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		mockApi();

		const {container} = renderComponent();

		await screen.findByText('저장할 페이지');
		expect(await axe(container)).toHaveNoViolations();
	});
});
