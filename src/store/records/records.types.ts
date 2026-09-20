import {Story} from '../stories';

// 노션 초안 폴더의 종류. api/notion/retros.ts의 kind와 같은 값이다.
export type DraftKind = 'retro' | 'scenario' | 'story';

// 홈의 한 줄이 자기 안에 뭐가 들었는지 그리는 데 쓰는 모양.
//
// 회고는 평행우주 다발, 시나리오는 막과 결말, 초안은 아직 아무것도 안 열린 상태다.
// 구절 태그(`우주`/`허브`/`막`/`결말`)에서 뽑는다 — 프롬프트가 심어 주고 twee에 그대로
// 실려 노션 왕복에도 살아남는다. 태그가 없는 예전 스토리는 구절 수로 떨어진다.
export type RecordShape =
	| {type: 'universes'; count: number}
	| {type: 'acts'; acts: number; endings: number}
	| {type: 'passages'; count: number};

export interface DraftRecord {
	kind: 'draft';
	/** 정렬·매칭에 쓰는 키. 초안은 노션 페이지 ID가 곧 신원이다. */
	id: string;
	pageId: string;
	title: string;
	draftKind: DraftKind;
	editedAt?: Date;
}

export interface StoryRecord {
	kind: 'story';
	id: string;
	title: string;
	story: Story;
	/** 제목이 같은 노션 초안 페이지. 없을 수도 있다(노션 없이 만든 스토리). */
	pageId?: string;
	draftKind?: DraftKind;
	shape: RecordShape;
	editedAt: Date;
}

export type HomeRecord = DraftRecord | StoryRecord;
