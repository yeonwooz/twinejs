// 스토리를 노션 어디에 저장할지 고르는 화면.
//
// 고르는 것은 **페이지 하나**다. 초안(회고·시나리오·스토리 구상)도 twee 스토리 DB도
// 전부 그 아래에 정해진 모양으로 들어간다(api/_lib/stories-db.ts). 예전에는 초안
// 페이지와 스토리 DB를 따로 골랐고, 고르지 않으면 앱이 워크스페이스에서 찾은 DB를
// 대신 정해줬다 — 그래서 저장 위치가 뒤죽박죽이 되고, 팀 워크스페이스에서는 모두가
// 같은 DB를 보게 됐다. 선택을 하나로 줄이고 기본값 추측을 없앤 것이 이 화면이다.
//
// 연결이 안 된 사용자도 여기서 노션에 연결할 수 있어야 한다. 예전에는 연결 링크가
// 회고/시나리오 위저드 안에만 있어서, 새 컴퓨터에서 이 화면으로 먼저 들어오면 막혔다.
import {IconCheck, IconPlugConnected, IconX} from '@tabler/icons';
import * as React from 'react';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {forgetSyncStatus} from '../../store/persistence/notion-sync';
import {useSyncStatus} from '../../store/persistence/notion-sync/use-sync-status';
import {DialogComponentProps} from '../dialogs.types';
import './notion-storage-dialog.css';

interface PageOption {
	id: string;
	title: string;
	mine?: boolean;
}

interface StorageInfo {
	connected: boolean;
	pages: PageOption[];
	selected: {rootId: string} | null;
}

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
	const [root, setRoot] = React.useState<string>();
	const [error, setError] = React.useState<string>();
	const [busy, setBusy] = React.useState(false);
	const sync = useSyncStatus();

	React.useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const loaded: StorageInfo = await api('/api/notion/root');

				if (cancelled) {
					return;
				}

				setInfo(loaded);
				setRoot(loaded.selected?.rootId ?? undefined);
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
		setBusy(true);
		try {
			await api('/api/notion/root', {pageId: root});
			forgetSyncStatus();
			props.onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	const current = info?.pages.find(p => p.id === info.selected?.rootId);
	const changed = !!root && root !== info?.selected?.rootId;
	const sharedWorkspace = !!info?.pages.some(p => p.mine === false);

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
				{info && !info.connected && (
					<p className="storage-hint">
						노션에 연결되어 있지 않습니다. 연결하면 스토리와 초안이 노션에
						저장되고, 다른 컴퓨터에서도 이어서 쓸 수 있습니다.
					</p>
				)}
				{info?.connected && (
					<>
						<p className="storage-hint">
							노션 페이지 하나를 고르면 그 아래에 이렇게 정리됩니다.
						</p>
						<pre className="storage-layout">
							{[
								current ? current.title : '고른 페이지',
								'├─ 회고 초안 (페이지들)',
								'├─ 시나리오/',
								'├─ 스토리/',
								'└─ Twine Stories (DB) ← 스토리(twee)'
							].join('\n')}
						</pre>
						<div className="storage-group">
							<h3>저장할 페이지</h3>
							{info.pages.length === 0 && (
								<p className="storage-hint">
									공유된 페이지가 없습니다. 노션에 다시 연결하면서 저장할
									페이지를 공유해 주세요.
								</p>
							)}
							{info.pages.map(page => (
								<label key={page.id}>
									<input
										checked={root === page.id}
										name="notion-storage-root"
										onChange={() => setRoot(page.id)}
										type="radio"
									/>
									{page.title}
									{page.mine && (
										<span className="storage-note">내가 만든 페이지</span>
									)}
									{page.id === info.selected?.rootId && (
										<span className="storage-note">현재 저장 위치</span>
									)}
								</label>
							))}
						</div>
						{sharedWorkspace && (
							<p className="storage-hint">
								같은 워크스페이스를 쓰는 다른 사람이 공유한 페이지도 보입니다.
								같은 페이지를 고른 사람끼리는 스토리를 함께 보게 되니, 혼자 쓸
								거라면 자기 페이지를 고르세요.
							</p>
						)}
						<p className="storage-hint">
							바꿔도 예전 곳의 스토리는 노션에 그대로 남고, 이 앱에 있는
							스토리도 지워지지 않습니다. 이후에 저장되는 것만 새 위치로 갑니다.
						</p>
					</>
				)}
			</CardContent>
			<ButtonBar>
				{info && !info.connected ? (
					<IconButton
						icon={<IconPlugConnected />}
						label="노션 연결하기"
						onClick={() => {
							window.location.href = '/api/notion/login';
						}}
						variant="primary"
					/>
				) : (
					// 라벨이 곧 동작이다 — "저장"만 있으면 무엇이 저장되는지(스토리인가
					// 설정인가) 알 수 없다는 지적을 받았다.
					<IconButton
						disabled={busy || !changed}
						icon={<IconCheck />}
						label="여기에 저장하기"
						onClick={save}
						variant="primary"
					/>
				)}
				<IconButton icon={<IconX />} label="닫기" onClick={props.onClose} />
			</ButtonBar>
		</DialogCard>
	);
};
