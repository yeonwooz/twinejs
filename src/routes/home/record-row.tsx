// 홈 목록의 한 줄. 초안이든 완성된 스토리든 같은 모양의 줄로 그린다 — 둘은 한 물건의
// 두 상태이지 다른 종류가 아니다.
import {IconEdit, IconPencil, IconPlayerPlay} from '@tabler/icons';
import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {IconButton} from '../../components/control/icon-button';
import {HomeRecord} from '../../store/records';
import {MoveStoryButton} from './move-story-button';
import {RecordShapeGlyph} from './record-shape';
import './record-row.css';

const DAY_MS = 24 * 60 * 60 * 1000;

function monthLabel(date?: Date) {
	return date ? `${date.getMonth() + 1}월` : '';
}

function agoLabel(date?: Date) {
	if (!date) {
		return '';
	}

	const days = Math.floor((Date.now() - date.getTime()) / DAY_MS);

	if (days <= 0) {
		return '오늘';
	}

	if (days === 1) {
		return '어제';
	}

	if (days < 30) {
		return `${days}일 전`;
	}

	return `${Math.floor(days / 30)}달 전`;
}

function shapeLabel(record: HomeRecord) {
	if (record.kind === 'draft') {
		return `쓰다 만 지 ${agoLabel(record.editedAt) || '얼마 안 됨'}`;
	}

	switch (record.shape.type) {
		case 'universes':
			return `평행우주 ${record.shape.count}`;
		case 'acts':
			return `${record.shape.acts}막 · 결말 ${record.shape.endings}개`;
		case 'passages':
			return `구절 ${record.shape.count}개`;
	}
}

// 헤더의 표시등은 앱 전체가 저장되는지만 말한다. 스토리 하나가 예전 저장 위치에
// 남아 있거나 아예 올라간 적이 없는 건 지금까지 어디에도 안 보였다.
function locationLabel(record: HomeRecord, moved: boolean) {
	if (record.kind !== 'story' || moved) {
		return undefined;
	}

	switch (record.location) {
		case 'elsewhere':
			return '다른 곳에 저장됨';
		case 'none':
			return '노션에 없음';
		default:
			return undefined;
	}
}

export interface RecordRowProps {
	record: HomeRecord;
}

export const RecordRow: React.FC<RecordRowProps> = ({record}) => {
	const history = useHistory();
	// 방금 옮긴 줄. useRecords의 location은 다음 로드까지 예전 값이라, 버튼이 "옮김"을
	// 띄우는 동안 옆에서는 "다른 곳에 저장됨"이라고 우기는 꼴이 된다.
	const [moved, setMoved] = React.useState(false);
	const label = locationLabel(record, moved);

	return (
		<li className="record-row">
			<span className="month">{monthLabel(record.editedAt)}</span>
			<span className="body">
				<span className="title">{record.title}</span>
				<span className="meta">
					<RecordShapeGlyph
						shape={record.kind === 'story' ? record.shape : undefined}
					/>
					<span className="detail">{shapeLabel(record)}</span>
					{label && <span className="detail warn">· {label}</span>}
				</span>
			</span>
			<span className="actions">
				{record.kind === 'story' && (
					<MoveStoryButton
						location={record.location}
						onMoved={() => setMoved(true)}
						storyId={record.id}
					/>
				)}
				{record.kind === 'draft' ? (
					<IconButton
						icon={<IconPencil />}
						label="이어서 쓰기"
						onClick={() => history.push(`/make/${record.pageId}`)}
						variant="primary"
					/>
				) : (
					<>
						<IconButton
							icon={<IconPlayerPlay />}
							iconOnly
							label="재생"
							onClick={() => history.push(`/stories/${record.id}/play`)}
						/>
						<IconButton
							icon={<IconEdit />}
							iconOnly
							label="편집"
							onClick={() => history.push(`/stories/${record.id}`)}
						/>
					</>
				)}
			</span>
		</li>
	);
};
