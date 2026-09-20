// 홈 목록의 한 줄. 초안이든 완성된 스토리든 같은 모양의 줄로 그린다 — 둘은 한 물건의
// 두 상태이지 다른 종류가 아니다.
import {IconEdit, IconPencil, IconPlayerPlay} from '@tabler/icons';
import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {IconButton} from '../../components/control/icon-button';
import {HomeRecord} from '../../store/records';
import {StoryDbButton} from './story-db-button';
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

export interface RecordRowProps {
	record: HomeRecord;
}

export const RecordRow: React.FC<RecordRowProps> = ({record}) => {
	const history = useHistory();

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
				</span>
			</span>
			<span className="actions">
				{record.kind === 'story' && (
					<StoryDbButton dbId={record.dbId} storyId={record.id} />
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
