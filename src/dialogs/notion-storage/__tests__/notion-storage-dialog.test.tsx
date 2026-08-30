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
	options: [
		{id: 'db-a', title: '회고 스토리'},
		{id: 'db-b', title: '창작 스토리'}
	],
	pages: [
		{id: 'page-1', title: '스터디'},
		{id: 'page-2', title: '새 루트'}
	],
	selected: {dbId: 'db-a', rootId: 'page-1'},
	isDefault: false
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

function bodyOf(fetchMock: jest.Mock) {
	const call = fetchMock.mock.calls.find(
		([, opts]) => (opts as RequestInit)?.method === 'POST'
	);

	return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
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
		mockApi({connected: false, options: [], pages: []});
		renderComponent();

		expect(await screen.findByText('노션 연결하기')).toBeInTheDocument();
		expect(screen.queryByText('여기에 저장하기')).toBeNull();
	});

	// 초안은 페이지에, twee는 DB에 들어간다. 성격이 다르니 목록을 나눈다.
	it('초안 페이지와 스토리 DB를 따로 고르게 한다', async () => {
		mockApi();
		renderComponent();

		expect(
			await screen.findByText('초안을 담아 둘 페이지')
		).toBeInTheDocument();
		expect(screen.getByText('스토리(twee)를 저장할 DB')).toBeInTheDocument();
		expect(
			screen.getByRole('radio', {name: /스터디/, checked: true})
		).toBeInTheDocument();
		expect(
			screen.getByRole('radio', {name: /회고 스토리/, checked: true})
		).toBeInTheDocument();
	});

	it('초안 페이지를 바꾸면 rootId를 보낸다', async () => {
		const fetchMock = mockApi();
		const onClose = jest.fn();

		renderComponent({onClose});
		await screen.findByText('초안을 담아 둘 페이지');
		await userEvent.click(screen.getByRole('radio', {name: /새 루트/}));
		await userEvent.click(screen.getByText('여기에 저장하기'));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(bodyOf(fetchMock)).toEqual({rootId: 'page-2', dbId: 'db-a'});
	});

	it('DB를 바꾸면 dbId를 보낸다', async () => {
		const fetchMock = mockApi();

		renderComponent();
		await screen.findByText('스토리(twee)를 저장할 DB');
		await userEvent.click(screen.getByRole('radio', {name: /창작 스토리/}));
		await userEvent.click(screen.getByText('여기에 저장하기'));

		await waitFor(() =>
			expect(bodyOf(fetchMock)).toEqual({rootId: 'page-1', dbId: 'db-b'})
		);
	});

	it('평소에는 DB 목록에 페이지를 섞지 않는다', async () => {
		mockApi();
		renderComponent();
		await screen.findByText('스토리(twee)를 저장할 DB');

		// 페이지 라디오는 초안 쪽 하나씩만 있다(DB 쪽에 섞여 있지 않다).
		expect(screen.getAllByRole('radio', {name: /새 루트/})).toHaveLength(1);
	});

	it('펼쳐서 페이지를 고르면 그 아래에 만든다', async () => {
		const fetchMock = mockApi();

		renderComponent();
		await screen.findByText('스토리(twee)를 저장할 DB');
		await userEvent.click(screen.getByText('› 다른 곳에 새로 만들기'));
		await userEvent.click(
			screen.getAllByRole('radio', {name: /새 루트/})[1] ??
				screen.getByRole('radio', {name: /새 루트/})
		);
		await userEvent.click(screen.getByText('여기에 저장하기'));

		await waitFor(() =>
			expect(bodyOf(fetchMock)).toEqual({
				rootId: 'page-1',
				createDbUnder: 'page-2'
			})
		);
	});

	it('바꾼 게 없으면 저장 버튼이 눌리지 않는다', async () => {
		mockApi();
		renderComponent();
		await screen.findByText('초안을 담아 둘 페이지');

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

		await screen.findByText('초안을 담아 둘 페이지');
		expect(await axe(container)).toHaveNoViolations();
	});
});
