// 홈 맨 위 작문대. 이 앱에서 뭔가를 만드는 유일한 입구다.
//
// 예전에는 입구가 셋이었다 — "회고" 버튼, "시나리오" 버튼, "새 스토리" 버튼. 앞의 둘은
// 같은 컴포넌트에 문구만 달랐고, 셋 다 제목부터 물은 다음에야 본문을 쓰게 했다. 여기서는
// 쓰기 시작하는 게 곧 만들기이고, 제목은 기본값이 채워진 채 아래에 조용히 앉아 있다.
import {IconArrowRight, IconSettings} from '@tabler/icons';
import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {IconButton} from '../../components/control/icon-button';
import {DraftKind} from '../../store/records';
import {fetchJson} from '../../util/json-fetch';
import './composer.css';

// 회고는 주기적으로 쓰는 물건이라 제목이 거의 정해져 있다. 미리 채워 두고 고치게 한다.
// 시나리오는 이름 자체가 창작이라 비워 둔다.
function defaultRetroTitle(now = new Date()) {
	const week = Math.floor((now.getDate() - 1) / 7) + 1;

	return `${now.getMonth() + 1}월 ${week}주차 회고`;
}

const COPY: Record<
	Extract<DraftKind, 'retro' | 'scenario'>,
	{prompt: string; placeholder: string}
> = {
	retro: {
		prompt: '이번엔, 무슨 일이 있었어?',
		placeholder:
			'어떤 결정을 했고, 무엇이 후회되고, 무엇이 좋았는지 편하게 적어 주세요. 고르지 않은 길이 무엇이었는지까지 적으면 더 좋아요.'
	},
	scenario: {
		prompt: '어떤 이야기를 짓고 싶어?',
		placeholder:
			'장르, 주인공, 배경, 갈등, 원하는 결말의 분위기… 떠오르는 대로 적어 주세요.'
	}
};

export interface ComposerProps {
	/** 새 초안을 만든 뒤 홈 목록을 다시 받아오게 한다. */
	onCreated: () => void;
	onOpenSettings: () => void;
}

export const Composer: React.FC<ComposerProps> = ({
	onCreated,
	onOpenSettings
}) => {
	const history = useHistory();
	const [kind, setKind] = React.useState<'retro' | 'scenario'>('retro');
	const [draft, setDraft] = React.useState('');
	const [title, setTitle] = React.useState(defaultRetroTitle());
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	// 설정을 고쳐야 넘어갈 수 있는 실패(미연결·초안 페이지 미선택)인지.
	const [needsSettings, setNeedsSettings] = React.useState(false);

	function changeKind(next: 'retro' | 'scenario') {
		setKind(next);
		setError(undefined);
		// 사용자가 손대지 않은 기본 제목만 갈아끼운다.
		setTitle(current =>
			current === '' || current === defaultRetroTitle()
				? next === 'retro'
					? defaultRetroTitle()
					: ''
				: current
		);
	}

	async function submit() {
		const body = draft.trim();
		const name = title.trim();

		if (!body) {
			return;
		}

		if (!name) {
			setError('제목을 한 줄 적어 주세요.');
			return;
		}

		setBusy(true);
		setError(undefined);
		setNeedsSettings(false);

		try {
			const page = await fetchJson('/api/notion/retros', {
				body: {title: name, kind}
			});

			onCreated();
			// 본문은 라우터 state로 넘긴다 — 방금 쓴 걸 노션에 올렸다가 다시 받아올
			// 이유가 없고, 왕복 한 번이 그대로 대기 시간이다.
			history.push(`/make/${page.id}`, {draft: body, kind});
		} catch (e) {
			// 401은 미연결, 400은 초안 페이지 미선택 — 둘 다 설정에서 고친다.
			const status = (e as {status?: number}).status;

			setNeedsSettings(status === 401 || status === 400);
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="composer">
			<h2>{COPY[kind].prompt}</h2>
			<textarea
				disabled={busy}
				onChange={e => setDraft(e.target.value)}
				placeholder={COPY[kind].placeholder}
				rows={7}
				value={draft}
			/>
			<div className="composer-row">
				<label className="composer-title">
					제목
					<input
						disabled={busy}
						onChange={e => setTitle(e.target.value)}
						placeholder={
							kind === 'retro' ? '예: 3주차 회고' : '예: 경성 미스터리'
						}
						type="text"
						value={title}
					/>
				</label>
			</div>
			<div className="composer-row">
				<div className="composer-kinds" role="radiogroup">
					<label>
						<input
							checked={kind === 'retro'}
							disabled={busy}
							name="composer-kind"
							onChange={() => changeKind('retro')}
							type="radio"
						/>
						회고
					</label>
					<label>
						<input
							checked={kind === 'scenario'}
							disabled={busy}
							name="composer-kind"
							onChange={() => changeKind('scenario')}
							type="radio"
						/>
						창작 시나리오
					</label>
				</div>
				<IconButton
					disabled={busy || !draft.trim()}
					icon={<IconArrowRight />}
					iconPosition="end"
					label={busy ? '만드는 중…' : '만들기'}
					onClick={submit}
					variant="primary"
				/>
			</div>
			{error && (
				<p className="composer-error">
					{error}
					{needsSettings && (
						<IconButton
							icon={<IconSettings />}
							label="설정 열기"
							onClick={onOpenSettings}
						/>
					)}
				</p>
			)}
		</section>
	);
};
