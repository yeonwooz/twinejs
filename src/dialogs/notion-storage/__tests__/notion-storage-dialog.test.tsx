import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {axe} from 'jest-axe';
import * as React from 'react';
import {DialogComponentProps} from '../../dialogs.types';
import {NotionStorageDialog} from '../notion-storage-dialog';

const INFO = {
	options: [
		{id: 'db-a', title: '회고 스토리'},
		{id: 'db-b', title: '창작 스토리'}
	],
	pages: [{id: 'page-1', title: '새 루트'}],
	selected: {write: 'db-a', read: ['db-a', 'db-b']}
};

function mockApi(post: unknown = {ok: true}) {
	const fetchMock = jest.fn(async (_url: string, opts?: RequestInit) => ({
		ok: true,
		status: 200,
		json: async () => (opts?.method === 'POST' ? post : INFO)
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

	it('지금 저장 위치와 읽는 위치를 표시한다', async () => {
		mockApi();
		renderComponent();

		expect(
			await screen.findByRole('radio', {name: '회고 스토리'})
		).toBeChecked();
		// 읽기 체크박스는 DB가 둘 이상일 때만 나온다.
		expect(screen.getByRole('checkbox', {name: '창작 스토리'})).toBeChecked();
	});

	it('저장할 곳과 읽을 곳을 함께 보낸다', async () => {
		const fetchMock = mockApi();
		const onClose = jest.fn();

		renderComponent({onClose});
		await screen.findByRole('radio', {name: '회고 스토리'});
		// 창작 DB는 읽기에서 뺀다.
		await userEvent.click(screen.getByRole('checkbox', {name: '창작 스토리'}));
		await userEvent.click(screen.getByText('저장'));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(bodyOf(fetchMock)).toEqual({write: 'db-a', read: ['db-a']});
	});

	it('저장할 DB는 읽기에서 뺄 수 없다', async () => {
		mockApi();
		renderComponent();

		const readCheckbox = await screen.findByRole('checkbox', {
			name: '회고 스토리'
		});

		expect(readCheckbox).toBeDisabled();
		expect(readCheckbox).toBeChecked();
	});

	it('고른 노션 페이지를 새 저장 위치로 연결한다', async () => {
		const fetchMock = mockApi({ok: true, dbId: 'db-c'});

		renderComponent();
		await screen.findByRole('radio', {name: '회고 스토리'});
		await userEvent.selectOptions(screen.getByRole('combobox'), 'page-1');
		await userEvent.click(screen.getByText('이 페이지 연결'));

		await waitFor(() =>
			expect(bodyOf(fetchMock)).toEqual({addRootId: 'page-1'})
		);
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

		await screen.findByRole('radio', {name: '회고 스토리'});
		expect(await axe(container)).toHaveNoViolations();
	});
});
