// 홈. 위는 작문대, 아래는 기록 연대기.
//
// 예전 홈은 Twine 원래의 스토리 카드 그리드에 툴바 탭 다섯 개였다. 카드는 제목과 태그만
// 보여줬고, 쓰다 만 노션 초안은 아예 나타나지 않았으며, 만들기 입구가 셋(회고·시나리오·
// 새 스토리)으로 갈려 있었다. 그 화면은 /stories로 그대로 내려갔다 — 편집기와 라이브러리
// 기능은 계속 필요하니 없애지 않는다.
import {IconSettings} from '@tabler/icons';
import * as React from 'react';
import {Link} from 'react-router-dom';
import {IconButton} from '../../components/control/icon-button';
import {DocumentTitle} from '../../components/document-title/document-title';
import {SyncStatusChip} from '../../components/sync-status-chip/sync-status-chip';
import {
	DialogsContextProvider,
	SettingsDialog,
	useDialogsContext
} from '../../dialogs';
import {useRecords} from '../../store/records';
import {Composer} from './composer';
import {RecordRow} from './record-row';
import {useSetupPrompt} from './use-setup-prompt';
import './home-route.css';

const InnerHomeRoute: React.FC = () => {
	const {dispatch} = useDialogsContext();
	const {records, loading, refresh} = useRecords();

	const openSettings = React.useCallback(
		() => dispatch({type: 'addDialog', component: SettingsDialog}),
		[dispatch]
	);

	useSetupPrompt(openSettings);

	return (
		<div className="home-route">
			<DocumentTitle title="인터랙티브 회고" />
			<header>
				<h1>인터랙티브 회고</h1>
				<div className="home-header-actions">
					<SyncStatusChip onClick={openSettings} />
					<IconButton
						icon={<IconSettings />}
						iconOnly
						label="설정"
						onClick={openSettings}
					/>
				</div>
			</header>

			<Composer onCreated={refresh} onOpenSettings={openSettings} />

			<hr />

			{records.length === 0 ? (
				<p className="home-empty">
					{loading
						? '불러오는 중…'
						: '아직 아무것도 없어요. 위에 몇 줄 적어 보세요.'}
				</p>
			) : (
				<ul className="home-records">
					{records.map(record => (
						<RecordRow key={`${record.kind}:${record.id}`} record={record} />
					))}
				</ul>
			)}

			<footer>
				<Link to="/stories">전체 스토리</Link>
			</footer>
		</div>
	);
};

export const HomeRoute: React.FC = () => (
	<DialogsContextProvider>
		<InnerHomeRoute />
	</DialogsContextProvider>
);
