// 설정 한 곳. 노션 연결, 초안을 담아 둘 페이지, 스토리를 저장할 DB, AI 키, 동기화 상태.
//
// 예전에는 이게 세 군데로 흩어져 있었다 — 위저드의 connect/root/apikey 단계, "저장 위치"
// 다이얼로그, 그리고 홈 첫 진입 프롬프트. 루트 페이지를 두 화면에서 서로 다른 말로 두 번
// 물었고, AI 키는 위저드 안에만 있어서 저장 위치 화면으로 먼저 들어온 사람은 넣을 길이
// 없었다. 전부 여기로 모은다.
//
// 저장할 곳은 두 가지이고 성격이 다르다 — 초안 원고는 **페이지** 아래에, twee 스토리는
// **DB** 안에 들어간다. 한때 이 둘을 한 라디오 목록에 형제처럼 놓았다가 무슨 선택인지
// 알 수 없다는 지적을 받았고, 반대로 DB 하나로 뭉갰다가는 회고·시나리오가
// "root not selected"로 깨졌다. 그래서 각각 고르게 하되, 한 목록에는 한 종류만 넣는다.
import {IconCheck, IconPlugConnected, IconX} from '@tabler/icons';
import * as React from 'react';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {
	forgetSyncStatus,
	pinStoriesToCurrentDb
} from '../../store/persistence/notion-sync';
import {forgetStoriesDbs} from '../../routes/home/use-stories-dbs';
import {useSyncStatus} from '../../store/persistence/notion-sync/use-sync-status';
import {fetchJson} from '../../util/json-fetch';
import {DialogComponentProps} from '../dialogs.types';
import './settings-dialog.css';

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

interface LlmInfo {
	provider: string | null;
	keyExpiresInHours?: number;
}

export const SettingsDialog: React.FC<DialogComponentProps> = props => {
	const [info, setInfo] = React.useState<StorageInfo>();
	const [llm, setLlm] = React.useState<LlmInfo>();
	const [root, setRoot] = React.useState<string>();
	const [db, setDb] = React.useState<string>();
	// "다른 곳에 새로 만들기"로 고른 페이지. DB를 고르는 것과 성격이 달라 접어둔다.
	const [createUnder, setCreateUnder] = React.useState<string>();
	const [creating, setCreating] = React.useState(false);
	const [keyInput, setKeyInput] = React.useState('');
	const [keyError, setKeyError] = React.useState<string>();
	const [error, setError] = React.useState<string>();
	const [busy, setBusy] = React.useState(false);
	const [nonce, setNonce] = React.useState(0);
	const sync = useSyncStatus();

	React.useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const loaded: StorageInfo = await fetchJson('/api/notion-sync/dbs');

				if (cancelled) {
					return;
				}

				setInfo(loaded);
				setRoot(loaded.selected?.rootId ?? undefined);
				setDb(loaded.selected?.dbId ?? undefined);

				// 미연결이면 /api/llm이 401이다 — 물어볼 것도 없다.
				if (loaded.connected) {
					const key: LlmInfo = await fetchJson('/api/llm');

					if (!cancelled) {
						setLlm(key);
					}
				}
			} catch (e) {
				if (!cancelled) {
					setError(e instanceof Error ? e.message : String(e));
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [nonce]);

	async function save() {
		setBusy(true);
		try {
			// 기본 저장 위치가 바뀌기 전에, 지금 있는 스토리들이 어디 있었는지 적어 둔다.
			// 안 그러면 바꾸는 순간 전부 새 DB를 가리키고, 노션에 멀쩡히 있는 스토리가
			// 앱에서 사라진 것처럼 보인다.
			pinStoriesToCurrentDb();
			await fetchJson('/api/notion-sync/dbs', {
				body: {
					...(root ? {rootId: root} : {}),
					...(creating && createUnder ? {createDbUnder: createUnder} : {}),
					...(!creating && db ? {dbId: db} : {})
				}
			});
			forgetSyncStatus();
			forgetStoriesDbs();
			props.onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function submitKey() {
		const key = keyInput.trim();

		setKeyError(undefined);

		if (!key) {
			setKeyError('API 키를 입력해 주세요.');
			return;
		}

		try {
			setLlm(await fetchJson('/api/llm', {body: {key}}));
			setKeyInput('');
		} catch (e) {
			setKeyError(e instanceof Error ? e.message : String(e));
		}
	}

	async function deleteKey() {
		if (
			!window.confirm(
				'저장된 AI API 키를 지울까요? Notion 연결은 그대로 유지돼요.'
			)
		) {
			return;
		}

		try {
			setLlm(await fetchJson('/api/llm', {method: 'DELETE'}));
			setKeyInput('');
			setKeyError(undefined);
		} catch (e) {
			setKeyError(e instanceof Error ? e.message : String(e));
		}
	}

	async function disconnect() {
		if (
			!window.confirm(
				'Notion 연결을 해제할까요? 함께 저장된 AI API 키도 지워져요.'
			)
		) {
			return;
		}

		try {
			await fetchJson('/api/session', {method: 'DELETE'});
			forgetSyncStatus();
			window.location.reload();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
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
			className="settings-dialog"
			fixedSize
			headerLabel="설정"
		>
			<CardContent>
				{error && (
					<p className="settings-error">
						{error}{' '}
						{/* 네트워크가 한 번 끊긴 것만으로 이 화면이 막다른 길이 됐다.
						    닫았다 다시 여는 것 말고 빠져나갈 길이 없었다. */}
						<button
							className="settings-disclosure"
							onClick={() => {
								setError(undefined);
								setInfo(undefined);
								setNonce(n => n + 1);
							}}
							type="button"
						>
							다시 시도
						</button>
					</p>
				)}
				{/* 동기화가 꺼졌거나 실패한 이유. 헤더의 표시등은 "저장 실패"까지만 말할
				    수 있으니, 고치러 온 이 화면에서 무엇이 문제였는지 그대로 보여준다. */}
				{!error && sync.reason && (
					<p className="settings-error">
						{sync.failing
							? '마지막 저장이 실패했습니다: '
							: '동기화가 꺼져 있습니다: '}
						{sync.reason}
					</p>
				)}
				{!info && !error && <p>불러오는 중…</p>}
				{info && !info.connected && (
					<p className="settings-hint">
						노션에 연결되어 있지 않습니다. 연결하면 스토리와 초안이 노션에
						저장되고, 다른 컴퓨터에서도 이어서 쓸 수 있습니다.
					</p>
				)}
				{info?.connected && (
					<>
						<div className="settings-group">
							<h3>초안을 담아 둘 페이지</h3>
							<p className="settings-hint">
								회고·시나리오 원고가 이 페이지 아래에 쌓입니다.
								{currentRoot ? ` 지금은 "${currentRoot.title}".` : ''}
							</p>
							{info.pages.map(page => (
								<label key={page.id}>
									<input
										checked={root === page.id}
										name="settings-root"
										onChange={() => setRoot(page.id)}
										type="radio"
									/>
									<span className="label-text" title={page.title}>
										{page.title}
									</span>
								</label>
							))}
						</div>
						<div className="settings-group">
							<h3>스토리(twee)를 저장할 DB</h3>
							{!creating && (
								<>
									{info.options.length === 0 && (
										<p className="settings-hint">
											노션에 스토리 DB가 없습니다. 아래에서 만들 곳을 골라
											주세요.
										</p>
									)}
									{info.options.map(option => (
										<label key={option.id}>
											<input
												checked={db === option.id}
												name="settings-db"
												onChange={() => setDb(option.id)}
												type="radio"
											/>
											<span className="label-text" title={option.title}>
												{option.title}
											</span>
											{option.id === info.selected?.dbId && (
												<span className="settings-note">현재 저장 위치</span>
											)}
										</label>
									))}
									<button
										className="settings-disclosure"
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
										className="settings-disclosure"
										onClick={() => {
											setCreating(false);
											setCreateUnder(undefined);
										}}
										type="button"
									>
										‹ 다른 곳에 새로 만들기
									</button>
									<p className="settings-hint">
										고른 페이지 아래에 스토리 DB가 생깁니다. 그 페이지에 이미
										있으면 그걸 그대로 씁니다.
									</p>
									{info.pages.map(page => (
										<label key={page.id}>
											<input
												checked={createUnder === page.id}
												name="settings-db"
												onChange={() => setCreateUnder(page.id)}
												type="radio"
											/>
											<span className="label-text" title={page.title}>
												{page.title}
											</span>
										</label>
									))}
								</>
							)}
						</div>
						<p className="settings-hint">
							바꿔도 예전 곳의 스토리는 노션에 그대로 남고, 이 앱에 있는
							스토리도 지워지지 않습니다. 이후에 저장되는 것만 새 위치로 갑니다.
							{currentDb && info.isDefault
								? ' (지금 DB는 앱이 정한 기본값)'
								: ''}
						</p>

						<div className="settings-group">
							<h3>AI 모델 API 키</h3>
							{llm?.provider ? (
								<>
									<p className="settings-hint">
										{llm.provider} 키가 저장돼 있어요.
										{typeof llm.keyExpiresInHours === 'number' &&
											` 입력 후 ${llm.keyExpiresInHours}시간이 지나면 자동으로 잊혀요.`}
									</p>
									<button
										className="settings-disclosure"
										onClick={deleteKey}
										type="button"
									>
										AI 키 삭제
									</button>
								</>
							) : (
								<>
									<p className="settings-hint">
										Anthropic(<code>sk-ant-...</code>) 또는 OpenAI(
										<code>sk-...</code>) 키. 암호화돼 이 브라우저 세션 쿠키에만
										저장돼요 — 노션·화면·서버 DB 어디에도 평문으로 남지 않아요.
									</p>
									<p className="settings-hint">
										🔒 유효기간이 짧고 사용 한도를 낮게 건 키를 발급해 쓰시길
										권해요. 다 쓰면 프로바이더 콘솔에서 폐기하세요.
									</p>
									<div className="settings-key">
										<input
											onChange={e => {
												setKeyInput(e.target.value);
												setKeyError(undefined);
											}}
											onKeyDown={e => {
												if (e.key === 'Enter') {
													submitKey();
												}
											}}
											placeholder="sk-ant-... / sk-..."
											type="password"
											value={keyInput}
										/>
										<IconButton
											disabled={!keyInput.trim()}
											icon={<IconCheck />}
											label="키 저장"
											onClick={submitKey}
										/>
									</div>
								</>
							)}
							{keyError && <p className="settings-error">{keyError}</p>}
						</div>

						<div className="settings-group">
							<h3>연결</h3>
							<button
								className="settings-disclosure"
								onClick={disconnect}
								type="button"
							>
								Notion 연결 해제
							</button>
						</div>
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
