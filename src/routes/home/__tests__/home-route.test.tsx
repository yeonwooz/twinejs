import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {HomeRoute} from '../home-route';
import {HomeRecord} from '../../../store/records';

const push = jest.fn();

jest.mock('react-router-dom', () => ({
	...jest.requireActual('react-router-dom'),
	useHistory: () => ({push})
}));

const records = jest.fn<HomeRecord[], []>();
const refresh = jest.fn();

jest.mock('../../../store/records', () => ({
	useRecords: () => ({
		records: records(),
		hasDrafts: true,
		loading: false,
		refresh
	})
}));

// 설정 프롬프트는 이 테스트의 관심사가 아니다(별도 네트워크 왕복).
jest.mock('../use-setup-prompt', () => ({useSetupPrompt: () => undefined}));

jest.mock('../../../components/sync-status-chip/sync-status-chip', () => ({
	SyncStatusChip: () => <div data-testid="mock-sync-chip" />
}));

function draft(overrides: Partial<HomeRecord> = {}) {
	return {
		kind: 'draft',
		id: 'page-1',
		pageId: 'page-1',
		title: '경성 미스터리',
		draftKind: 'scenario',
		editedAt: new Date('2026-09-01'),
		...overrides
	} as HomeRecord;
}

function story(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'story',
		id: 'story-1',
		title: '3주차 회고',
		story: {id: 'story-1', name: '3주차 회고'},
		shape: {type: 'universes', count: 4},
		editedAt: new Date('2026-09-05'),
		...overrides
	} as unknown as HomeRecord;
}

describe('<HomeRoute>', () => {
	beforeEach(() => {
		push.mockReset();
		records.mockReturnValue([]);
		(global as any).fetch = jest.fn(async () => ({
			ok: true,
			status: 200,
			headers: {get: () => 'application/json'},
			json: async () => ({id: 'new-page'})
		}));
	});

	function renderComponent() {
		return render(
			<MemoryRouter>
				<HomeRoute />
			</MemoryRouter>
		);
	}

	// 예전 홈에는 쓰다 만 초안이 아예 안 보였다 — 위저드에 들어가야만 목록을 받았다.
	it('초안과 스토리를 한 목록에 섞어 보여준다', () => {
		records.mockReturnValue([story(), draft()]);
		renderComponent();

		expect(screen.getByText('3주차 회고')).toBeInTheDocument();
		expect(screen.getByText('경성 미스터리')).toBeInTheDocument();
		expect(screen.getByText('평행우주 4')).toBeInTheDocument();
	});

	it('초안 줄은 이어서 쓰기로, 스토리 줄은 재생·편집으로 간다', async () => {
		records.mockReturnValue([story(), draft()]);
		renderComponent();

		await userEvent.click(screen.getByText('이어서 쓰기'));
		expect(push).toHaveBeenCalledWith('/make/page-1');

		await userEvent.click(screen.getByRole('button', {name: '재생'}));
		expect(push).toHaveBeenCalledWith('/stories/story-1/play');
	});

	// 만들기 입구가 셋(회고·시나리오·새 스토리)이었다. 이제 쓰는 게 곧 만들기다.
	it('작문대에 쓰면 초안을 만들고 /make로 보낸다', async () => {
		renderComponent();

		await userEvent.type(
			screen.getByRole('textbox', {name: ''}) ??
				screen.getByPlaceholderText(/어떤 결정을 했고/),
			'이번 주엔 배포를 미뤘다'
		);
		await userEvent.click(screen.getByText('만들기'));

		await waitFor(() =>
			expect(push).toHaveBeenCalledWith(
				'/make/new-page',
				expect.objectContaining({
					draft: '이번 주엔 배포를 미뤘다',
					kind: 'retro'
				})
			)
		);
		expect(refresh).toHaveBeenCalled();
	});

	it('아무것도 없으면 쓰라고 권한다', () => {
		renderComponent();
		expect(
			screen.getByText('아직 아무것도 없어요. 위에 몇 줄 적어 보세요.')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		records.mockReturnValue([story(), draft()]);

		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
