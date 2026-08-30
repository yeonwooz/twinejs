// 스토리를 노션 어디에 저장할지 고르는 화면.
//
// 저장할 곳은 두 가지이고 성격이 다르다 — 초안 원고는 **페이지** 아래에, twee 스토리는
// **DB** 안에 들어간다. 한때 이 둘을 한 라디오 목록에 형제처럼 놓았다가 무슨 선택인지
// 알 수 없다는 지적을 받았고, 반대로 DB 하나로 뭉갰다가는 회고·시나리오가
// "root not selected"로 깨졌다. 그래서 각각 고르게 하되, 한 목록에는 한 종류만 넣는다.
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

interface NamedItem {
	id: string;
	title: string;
}

interface StorageInfo {
	connected: boolean;
	options: NamedItem[];
	pages: NamedItem[];
	selected?: {dbId: string | null; rootId: string | null};
	isDefault?: boolean;
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
	const [db, setDb] = React.useState<string>();
	// "다른 곳에 새로 만들기"로 고른 페이지. DB를 고르는 것과 성격이 달라 접어둔다.
	const [createUnder, setCreateUnder] = React.useState<string>();
	const [creating, setCreating] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const [busy, setBusy] = React.useState(false);
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
				setRoot(loaded.selected?.rootId ?? undefined);
				setDb(loaded.selected?.dbId ?? undefined);
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
			await api('/api/notion-sync/dbs', {
				...(root ? {rootId: root} : {}),
				...(creating && createUnder ? {createDbUnder: createUnder} : {}),
				...(!creating && db ? {dbId: db} : {})
			});
			forgetSyncStatus();
			props.onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	const currentDb = info?.options.find(o => o.id === info.selected?.dbId);
	const currentRoot = info?.pages.find(p => p.id === info.selected?.rootId);
	// 지금 상태와 달라진 게 있어야 저장할 의미가 있다.
	const changed =
		(creating && !!createUnder) ||
		(!creating && !!db && db !== info?.selected?.dbId) ||
		(!!root && root !== info?.selected?.rootId);

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
						<div className="storage-group">
							<h3>초안을 담아 둘 페이지</h3>
							<p className="storage-hint">
								회고·시나리오·스토리 구상이 이 페이지 아래에 쌓입니다.
								{currentRoot ? ` 지금은 "${currentRoot.title}".` : ''}
							</p>
							{info.pages.map(page => (
								<label key={page.id}>
									<input
										checked={root === page.id}
										name="notion-storage-root"
										onChange={() => setRoot(page.id)}
										type="radio"
									/>
									{page.title}
								</label>
							))}
						</div>
						<div className="storage-group">
							<h3>스토리(twee)를 저장할 DB</h3>
							{!creating && (
								<>
									{info.options.length === 0 && (
										<p className="storage-hint">
											노션에 스토리 DB가 없습니다. 아래에서 만들 곳을 골라
											주세요.
										</p>
									)}
									{info.options.map(option => (
										<label key={option.id}>
											<input
												checked={db === option.id}
												name="notion-storage-db"
												onChange={() => setDb(option.id)}
												type="radio"
											/>
											{option.title}
											{option.id === info.selected?.dbId && (
												<span className="storage-note">현재 저장 위치</span>
											)}
										</label>
									))}
									<button
										className="storage-disclosure"
										onClick={() => setCreating(true)}
										type="button"
									>
										› 다른 곳에 새로 만들기
									</button>
								</>
							)}
							{creating && (
								<>
									<button
										className="storage-disclosure"
										onClick={() => {
											setCreating(false);
											setCreateUnder(undefined);
										}}
										type="button"
									>
										‹ 다른 곳에 새로 만들기
									</button>
									<p className="storage-hint">
										고른 페이지 아래에 스토리 DB가 생깁니다. 그 페이지에 이미
										있으면 그걸 그대로 씁니다.
									</p>
									{info.pages.map(page => (
										<label key={page.id}>
											<input
												checked={createUnder === page.id}
												name="notion-storage-db"
												onChange={() => setCreateUnder(page.id)}
												type="radio"
											/>
											{page.title}
										</label>
									))}
								</>
							)}
						</div>
						<p className="storage-hint">
							바꿔도 예전 곳의 스토리는 노션에 그대로 남고, 이 앱에 있는
							스토리도 지워지지 않습니다. 이후에 저장되는 것만 새 위치로 갑니다.
							{currentDb && info.isDefault
								? ' (지금 DB는 앱이 정한 기본값)'
								: ''}
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
