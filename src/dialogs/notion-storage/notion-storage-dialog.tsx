// 스토리를 노션 어디에 저장할지 고르는 화면. 저장 위치는 **한 곳**이다 — 고를 것도
// 하나고, 스토리가 노션 여기저기 흩어지지 않는다.
//
// 예전에는 "저장할 곳 하나 + 함께 읽어올 곳 여럿 + 페이지 추가"로 세 덩어리였고
// 버튼도 세 개였다. 읽는 곳을 따로 고르는 개념이 사라져서 목록 하나로 줄었다.
//
// 이 화면은 로그인해서 쓰는 배포 환경 전용이다. dev 서버는 .env.local이 정하므로
// 물을 게 없다(status 응답에 chosen이 없으면 띄우지 않는다).
import {IconCheck, IconX} from '@tabler/icons';
import * as React from 'react';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {forgetSyncStatus} from '../../store/persistence/notion-sync';
import {useSyncStatus} from '../../store/persistence/notion-sync/use-sync-status';
import {DialogComponentProps} from '../dialogs.types';
import './notion-storage-dialog.css';

interface NamedItem {
	id: string;
	title: string;
}

interface StorageInfo {
	options: NamedItem[];
	pages: NamedItem[];
	selected: string | null;
	isDefault: boolean;
}

// 고른 값은 둘 중 하나다 — 기존 DB(`db:<id>`)냐, 새로 만들 페이지(`page:<id>`)냐.
// 라디오 하나로 다루려고 접두어를 붙인다. 다만 화면에서는 섞어 보여주지 않는다 —
// "이걸 골라라"(DB)와 "여기에 새로 만들어라"(페이지)는 성격이 달라서, 형제처럼 한
// 목록에 놓으면 무슨 선택인지 알 수 없다.
const DB = 'db:';
const PAGE = 'page:';

async function api(path: string, body?: unknown) {
	const response = await fetch(path, {
		credentials: 'same-origin',
		...(body === undefined
			? {}
			: {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify(body)
				})
	});

	if (!response.ok) {
		let message = `요청 실패 (${response.status})`;

		try {
			const parsed = await response.json();

			if (parsed?.error) {
				message = parsed.error;
			}
		} catch {
			// 본문이 JSON이 아니면 상태 코드만 보여준다.
		}

		throw new Error(message);
	}

	return response.json();
}

export const NotionStorageDialog: React.FC<DialogComponentProps> = props => {
	const [info, setInfo] = React.useState<StorageInfo>();
	const [choice, setChoice] = React.useState<string>();
	const [error, setError] = React.useState<string>();
	const [busy, setBusy] = React.useState(false);
	// 새로 만드는 건 드문 일이라 접어둔다. 평소에는 DB 목록만 보인다.
	const [creating, setCreating] = React.useState(false);
	const sync = useSyncStatus();

	React.useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const loaded: StorageInfo = await api('/api/notion-sync/dbs');

				if (cancelled) {
					return;
				}

				setInfo(loaded);
				setChoice(loaded.selected ? DB + loaded.selected : undefined);
			} catch (e) {
				if (!cancelled) {
					setError(e instanceof Error ? e.message : String(e));
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	async function save() {
		if (!choice) {
			return;
		}

		setBusy(true);
		try {
			await api(
				'/api/notion-sync/dbs',
				choice.startsWith(PAGE)
					? {rootId: choice.slice(PAGE.length)}
					: {dbId: choice.slice(DB.length)}
			);
			forgetSyncStatus();
			props.onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	const current =
		info && info.selected
			? info.options.find(option => option.id === info.selected)
			: undefined;

	return (
		<DialogCard
			{...props}
			className="notion-storage-dialog"
			fixedSize
			headerLabel="스토리 저장 위치"
		>
			<CardContent>
				{error && <p className="storage-error">{error}</p>}
				{/* 동기화가 꺼졌거나 실패한 이유. 툴바 버튼은 "저장 실패"까지만 말할 수
				    있으니, 고치러 온 이 화면에서 무엇이 문제였는지 그대로 보여준다. */}
				{!error && sync.reason && (
					<p className="storage-error">
						{sync.failing
							? '마지막 저장이 실패했습니다: '
							: '동기화가 꺼져 있습니다: '}
						{sync.reason}
					</p>
				)}
				{!info && !error && <p>불러오는 중…</p>}
				{info && (
					<>
						<p className="storage-hint">
							{current
								? `지금 스토리는 노션의 "${current.title}"에 저장됩니다${
										info.isDefault ? ' (앱이 정한 기본값)' : ''
									}.`
								: '스토리를 저장할 곳이 아직 정해지지 않았습니다.'}
						</p>
						{/* 평소에는 고를 수 있는 DB만 보여준다. */}
						{!creating && (
							<>
								<div className="storage-group">
									{info.options.length === 0 && (
										<p className="storage-hint">
											노션에 스토리 DB가 없습니다. 아래에서 만들 곳을 골라
											주세요.
										</p>
									)}
									{info.options.map(option => (
										<label key={option.id}>
											<input
												checked={choice === DB + option.id}
												name="notion-storage"
												onChange={() => setChoice(DB + option.id)}
												type="radio"
											/>
											{option.title}
											{option.id === info.selected && (
												<span className="storage-note">현재 저장 위치</span>
											)}
										</label>
									))}
								</div>
								<button
									className="storage-disclosure"
									onClick={() => {
										setCreating(true);
										setChoice(undefined);
									}}
									type="button"
								>
									› 다른 곳에 새로 만들기
								</button>
								<p className="storage-hint">
									바꿔도 예전 곳의 스토리는 노션에 그대로 남고, 이 앱에 있는
									스토리도 지워지지 않습니다. 이후에 저장되는 것만 새 위치로
									갑니다.
								</p>
							</>
						)}
						{/* 새로 만드는 건 DB를 고르는 것과 성격이 다르다. 같은 목록에
						    섞지 않고, 펼쳤을 때만 따로 보여준다. */}
						{creating && (
							<>
								<button
									className="storage-disclosure"
									onClick={() => {
										setCreating(false);
										setChoice(info.selected ? DB + info.selected : undefined);
									}}
									type="button"
								>
									‹ 다른 곳에 새로 만들기
								</button>
								<p className="storage-hint">
									고른 페이지 아래에 스토리 DB가 생깁니다. 그 페이지에 이미
									있으면 그걸 그대로 씁니다.
								</p>
								<div className="storage-group">
									{info.pages.map(page => (
										<label key={page.id}>
											<input
												checked={choice === PAGE + page.id}
												name="notion-storage"
												onChange={() => setChoice(PAGE + page.id)}
												type="radio"
											/>
											{page.title}
										</label>
									))}
								</div>
							</>
						)}
					</>
				)}
			</CardContent>
			<ButtonBar>
				{/* 라벨이 곧 동작이다 — "저장"만 있으면 무엇이 저장되는지(스토리인가
				    설정인가) 알 수 없다는 지적을 받았다. */}
				<IconButton
					disabled={busy || !choice || choice === DB + info?.selected}
					icon={<IconCheck />}
					label="여기에 저장하기"
					onClick={save}
					variant="primary"
				/>
				<IconButton icon={<IconX />} label="닫기" onClick={props.onClose} />
			</ButtonBar>
		</DialogCard>
	);
};
