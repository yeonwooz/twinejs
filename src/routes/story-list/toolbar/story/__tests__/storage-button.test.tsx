import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {StorageButton} from '../storage-button';
import {SyncStatus} from '../../../../../store/persistence/notion-sync';

const status = jest.fn<SyncStatus, []>();

jest.mock(
	'../../../../../store/persistence/notion-sync/use-sync-status',
	() => ({
		useSyncStatus: () => status()
	})
);
jest.mock('../../../../../dialogs', () => ({
	NotionStorageDialog: () => null,
	useDialogsContext: () => ({dispatch: jest.fn()})
}));

// 예전에는 동기화 상태가 콘솔에만 있었다. 저장이 안 되고 있는데도 화면은 멀쩡해
// 보이는 게 오늘 있었던 사고들의 공통점이었다.
describe('<StorageButton>', () => {
	function renderWith(props: Partial<SyncStatus>) {
		status.mockReturnValue({
			connected: true,
			enabled: true,
			failing: false,
			...props
		});
		return render(<StorageButton />);
	}

	it('돌고 있으면 저장된다고 알려준다', () => {
		renderWith({});
		expect(screen.getByText('노션에 저장됨')).toBeInTheDocument();
	});

	it('노션에 연결이 안 됐으면 그렇게 말한다', () => {
		renderWith({connected: false, enabled: false});
		expect(screen.getByText('노션 연결 안 됨')).toBeInTheDocument();
	});

	it('연결은 됐지만 꺼져 있으면 저장 안 됨으로 보여준다', () => {
		renderWith({enabled: false});
		expect(screen.getByText('저장 안 됨')).toBeInTheDocument();
	});

	// 실패는 꺼진 것과 다르다 — 켜져 있는데 쓰기가 실패한 상태다.
	it('마지막 저장이 실패했으면 실패를 우선 보여준다', () => {
		renderWith({failing: true, reason: '노션 저장 실패 (404)'});
		expect(screen.getByText('저장 실패')).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderWith({});
		expect(await axe(container)).toHaveNoViolations();
	});
});
