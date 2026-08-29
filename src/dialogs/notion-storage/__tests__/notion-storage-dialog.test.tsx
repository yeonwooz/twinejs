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
	selected: 'db-a',
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

	it('지금 저장되는 곳을 골라 둔 상태로 보여준다', async () => {
		mockApi();
		renderComponent();

		expect(
			await screen.findByRole('radio', {name: /회고 스토리/})
		).toBeChecked();
		expect(
			screen.getByText(/지금 스토리는 노션의 "회고 스토리"에 저장됩니다/)
		).toBeInTheDocument();
		expect(screen.getByText('현재 저장 위치')).toBeInTheDocument();
	});

	// 읽는 곳을 따로 고르는 개념이 없어졌다 — 저장 위치 하나뿐이다.
	it('읽어올 곳을 따로 고르게 하지 않는다', async () => {
		mockApi();
		renderComponent();
		await screen.findByRole('radio', {name: /회고 스토리/});

		expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
	});

	it('앱이 정한 기본값이면 그렇다고 알려준다', async () => {
		mockApi({...INFO, isDefault: true});
		renderComponent();

		expect(await screen.findByText(/앱이 정한 기본값/)).toBeInTheDocument();
	});

	it('다른 DB를 고르면 그 DB만 보낸다', async () => {
		const fetchMock = mockApi();
		const onClose = jest.fn();

		renderComponent({onClose});
		await screen.findByRole('radio', {name: /회고 스토리/});
		await userEvent.click(screen.getByRole('radio', {name: /창작 스토리/}));
		await userEvent.click(screen.getByText('여기에 저장하기'));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(bodyOf(fetchMock)).toEqual({dbId: 'db-b'});
	});

	// DB를 고르는 것과 새로 만드는 것은 성격이 다르다. 같은 목록에 섞으면 무슨
	// 선택인지 알 수 없어서, 새로 만드는 쪽은 접어둔다.
	it('평소에는 페이지를 목록에 섞어 보여주지 않는다', async () => {
		mockApi();
		renderComponent();
		await screen.findByRole('radio', {name: /회고 스토리/});

		expect(screen.queryByRole('radio', {name: /새 루트/})).toBeNull();
	});

	it('펼치면 만들 페이지가 나오고, 고르면 그 아래에 만든다', async () => {
		const fetchMock = mockApi(INFO, {ok: true, dbId: 'db-c'});

		renderComponent();
		await screen.findByRole('radio', {name: /회고 스토리/});
		await userEvent.click(screen.getByText('› 다른 곳에 새로 만들기'));

		// 펼친 뒤에는 DB 목록 대신 페이지 목록만 보인다.
		expect(screen.queryByRole('radio', {name: /회고 스토리/})).toBeNull();

		await userEvent.click(screen.getByRole('radio', {name: /새 루트/}));
		await userEvent.click(screen.getByText('여기에 저장하기'));

		await waitFor(() => expect(bodyOf(fetchMock)).toEqual({rootId: 'page-1'}));
	});

	it('접으면 원래 저장 위치가 다시 골라진다', async () => {
		mockApi();
		renderComponent();
		await screen.findByRole('radio', {name: /회고 스토리/});
		await userEvent.click(screen.getByText('› 다른 곳에 새로 만들기'));
		await userEvent.click(screen.getByText('‹ 다른 곳에 새로 만들기'));

		expect(
			await screen.findByRole('radio', {name: /회고 스토리/})
		).toBeChecked();
	});

	it('아직 저장 위치가 없으면 그렇다고 알려준다', async () => {
		mockApi({...INFO, selected: null});
		renderComponent();

		expect(
			await screen.findByText('스토리를 저장할 곳이 아직 정해지지 않았습니다.')
		).toBeInTheDocument();
		expect(
			screen.getByText('여기에 저장하기').closest('button')
		).toBeDisabled();
	});

	// 지금 쓰는 곳을 그대로 다시 저장하는 건 아무 일도 안 하는 동작이라 막아둔다.
	it('현재 위치가 골라져 있으면 저장 버튼이 눌리지 않는다', async () => {
		mockApi();
		renderComponent();
		await screen.findByRole('radio', {name: /회고 스토리/});

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

		await screen.findByRole('radio', {name: /회고 스토리/});
		expect(await axe(container)).toHaveNoViolations();
	});
});
