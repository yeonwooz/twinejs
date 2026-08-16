// 스토리를 노션 어디에 저장할지 고르는 화면. 저장할 DB는 하나, 읽어올 DB는 여럿
// 고를 수 있다 — 루트 페이지를 나눠 쓰면(회고 루트, 창작 루트) 읽기는 합쳐 봐야
// 다른 루트의 스토리가 사라진 것으로 오해되지 않는다.
//
// 이 화면은 로그인해서 쓰는 배포 환경 전용이다. dev 서버는 .env.local이 정하므로
// 물을 게 없다(status 응답에 chosen이 없으면 띄우지 않는다).
import {IconCheck, IconPlus, IconX} from '@tabler/icons';
import * as React from 'react';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {forgetSyncStatus} from '../../store/persistence/notion-sync';
import {DialogComponentProps} from '../dialogs.types';
import './notion-storage-dialog.css';

interface NamedItem {
	id: string;
	title: string;
}

interface StorageInfo {
	options: NamedItem[];
	pages: NamedItem[];
	selected: {write: string | null; read: string[]};
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
	const [write, setWrite] = React.useState<string>();
	const [read, setRead] = React.useState<string[]>([]);
	const [addPage, setAddPage] = React.useState('');
	const [error, setError] = React.useState<string>();
	const [busy, setBusy] = React.useState(false);

	const load = React.useCallback(async () => {
		try {
			const loaded: StorageInfo = await api('/api/notion-sync/dbs');

			setInfo(loaded);
			setWrite(loaded.selected.write ?? loaded.options[0]?.id);
			setRead(
				loaded.selected.read.length
					? loaded.selected.read
					: loaded.options.map(option => option.id)
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);

	React.useEffect(() => {
		load();
	}, [load]);

	async function addRoot() {
		if (!addPage) {
			return;
		}

		setBusy(true);
		try {
			await api('/api/notion-sync/dbs', {addRootId: addPage});
			setAddPage('');
			await load();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function save() {
		if (!write) {
			return;
		}

		setBusy(true);
		try {
			await api('/api/notion-sync/dbs', {write, read});
			forgetSyncStatus();
			props.onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	function toggleRead(id: string) {
		setRead(prev =>
			prev.includes(id) ? prev.filter(other => other !== id) : [...prev, id]
		);
	}

	return (
		<DialogCard
			{...props}
			className="notion-storage-dialog"
			fixedSize
			headerLabel="스토리 저장 위치"
		>
			<CardContent>
				{error && <p className="storage-error">{error}</p>}
				{!info && !error && <p>불러오는 중…</p>}
				{info && (
					<>
						<div className="storage-group">
							<h3>새 스토리를 저장할 곳</h3>
							{info.options.length === 0 && (
								<p className="storage-hint">
									아직 연결된 곳이 없어요. 아래에서 노션 페이지를 고르면 그
									페이지 아래에 스토리 DB를 만들어 둡니다.
								</p>
							)}
							{info.options.map(option => (
								<label key={option.id}>
									<input
										checked={write === option.id}
										name="notion-storage-write"
										onChange={() => {
											setWrite(option.id);
											setRead(prev =>
												prev.includes(option.id) ? prev : [...prev, option.id]
											);
										}}
										type="radio"
									/>
									{option.title}
								</label>
							))}
						</div>
						{info.options.length > 1 && (
							<div className="storage-group">
								<h3>함께 읽어올 곳</h3>
								<p className="storage-hint">
									체크를 풀면 그 DB의 스토리는 이 앱에 나타나지 않습니다. 로컬에
									있는 스토리를 지우지는 않습니다.
								</p>
								{info.options.map(option => (
									<label key={option.id}>
										<input
											checked={read.includes(option.id)}
											disabled={write === option.id}
											onChange={() => toggleRead(option.id)}
											type="checkbox"
										/>
										{option.title}
									</label>
								))}
							</div>
						)}
						<div className="storage-group storage-add">
							<h3>노션 페이지 추가</h3>
							<select
								aria-label="연결할 노션 페이지"
								onChange={event => setAddPage(event.target.value)}
								value={addPage}
							>
								<option value="">고르세요…</option>
								{info.pages.map(page => (
									<option key={page.id} value={page.id}>
										{page.title}
									</option>
								))}
							</select>
						</div>
					</>
				)}
			</CardContent>
			<ButtonBar>
				<IconButton
					disabled={busy || !write}
					icon={<IconCheck />}
					label="저장"
					onClick={save}
					variant="primary"
				/>
				<IconButton
					disabled={busy || !addPage}
					icon={<IconPlus />}
					label="이 페이지 연결"
					onClick={addRoot}
				/>
				<IconButton icon={<IconX />} label="나중에" onClick={props.onClose} />
			</ButtonBar>
		</DialogCard>
	);
};
