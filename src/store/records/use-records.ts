// 홈이 그리는 "기록" 목록. 로컬 스토리와 노션 초안을 한 줄로 합친다.
//
// 예전에는 초안은 노션에, 스토리는 카드 목록에 따로 살아서 "쓰다 만 회고"가 앱 어디에도
// 안 보였다 — 알려면 위저드에 들어가 목록을 다시 받아야 했다. 둘을 하나로 본다.
//
// 초안과 스토리를 잇는 열쇠는 **제목**이다. scripts/retro-prompt.md가 `StoryTitle`을
// 초안 제목 그대로 쓰라고 못 박아 두어서(안 그러면 덮어쓸 대상을 못 찾는다) 이 매칭이
// 성립한다. 예전에 쓰던 localStorage 매핑(util/retro-link)과 달리 브라우저를 바꿔도
// 따라온다.
import * as React from 'react';
import {storyDbId} from '../persistence/notion-sync';
import {Story, useStoriesContext} from '../stories';
import {
	DraftKind,
	DraftRecord,
	HomeRecord,
	RecordShape,
	StoryRecord
} from './records.types';

const DRAFT_KINDS: DraftKind[] = ['retro', 'scenario', 'story'];

export function normalizeTitle(title: string) {
	return title.trim().toLowerCase();
}

// 구절 태그에서 모양을 뽑는다. 태그는 프롬프트가 심는다(retro-prompt.md /
// scenario-prompt.md의 "구조 태그"). 태그가 하나도 없는 예전 스토리는 구절 수로 떨어진다.
export function shapeOfStory(story: Story): RecordShape {
	let universes = 0;
	let acts = 0;
	let endings = 0;

	for (const passage of story.passages) {
		for (const tag of passage.tags) {
			switch (tag) {
				case '우주':
					universes++;
					break;
				case '막':
					acts++;
					break;
				case '결말':
					endings++;
					break;
			}
		}
	}

	if (universes > 0) {
		return {type: 'universes', count: universes};
	}

	if (acts > 0 || endings > 0) {
		return {type: 'acts', acts, endings};
	}

	return {type: 'passages', count: story.passages.length};
}

export interface RawDraft {
	id: string;
	title: string;
	editedAt?: string;
	kind: DraftKind;
}

// 홈 바깥(예: /make에 직접 들어왔을 때 그 초안이 회고인지 시나리오인지 알아내기)에서도
// 쓴다. 훅이 아니라 순수 함수로 둔 이유다.
export async function fetchDrafts(signal?: AbortSignal): Promise<RawDraft[]> {
	const perKind = await Promise.all(
		DRAFT_KINDS.map(async kind => {
			const response = await fetch(`/api/notion/retros?kind=${kind}`, {
				credentials: 'same-origin',
				signal
			});

			// 미연결(401)·루트 미선택(400)은 "초안을 못 보여줄 뿐"이다. content-type까지
			// 보는 건 vite dev가 없는 /api/* 에 index.html을 200으로 돌려주기 때문 —
			// ok만 보면 통과하고 json()에서 터진다. 로컬 스토리는 그대로 보여야 하므로
			// 어느 쪽이든 조용히 빈다.
			if (
				!response.ok ||
				!response.headers.get('content-type')?.includes('json')
			) {
				return [];
			}

			const {retros} = await response.json();

			return ((retros ?? []) as Omit<RawDraft, 'kind'>[]).map(draft => ({
				...draft,
				kind
			}));
		})
	);

	return perKind.flat();
}

export interface UseRecordsResult {
	records: HomeRecord[];
	/** 노션 초안까지 합친 목록인지. false면 로컬 스토리만 보고 있다. */
	hasDrafts: boolean;
	loading: boolean;
	/** 초안을 다시 받아온다(작문대에서 새 초안을 만든 뒤 등). */
	refresh: () => void;
}

export function useRecords(): UseRecordsResult {
	const {stories} = useStoriesContext();
	const [drafts, setDrafts] = React.useState<RawDraft[]>();
	const [loading, setLoading] = React.useState(true);
	const [nonce, setNonce] = React.useState(0);

	React.useEffect(() => {
		const controller = new AbortController();

		setLoading(true);
		fetchDrafts(controller.signal)
			.then(loaded => {
				setDrafts(loaded);
				setLoading(false);
			})
			.catch(() => {
				// 네트워크가 통째로 죽어도 홈은 떠야 한다.
				if (!controller.signal.aborted) {
					setDrafts(undefined);
					setLoading(false);
				}
			});

		return () => controller.abort();
	}, [nonce]);

	const refresh = React.useCallback(() => setNonce(n => n + 1), []);

	const records = React.useMemo(() => {
		const byTitle = new Map<string, RawDraft>();

		for (const draft of drafts ?? []) {
			byTitle.set(normalizeTitle(draft.title), draft);
		}

		const storyRecords: StoryRecord[] = stories.map(story => {
			const draft = byTitle.get(normalizeTitle(story.name));

			// 스토리가 된 초안은 초안 줄로 또 보여주지 않는다.
			if (draft) {
				byTitle.delete(normalizeTitle(story.name));
			}

			return {
				kind: 'story',
				id: story.id,
				title: story.name,
				story,
				pageId: draft?.id,
				draftKind: draft?.kind,
				shape: shapeOfStory(story),
				dbId: storyDbId(story.id),
				editedAt: story.lastUpdate
			};
		});

		const draftRecords: DraftRecord[] = [...byTitle.values()].map(draft => ({
			kind: 'draft',
			id: draft.id,
			pageId: draft.id,
			title: draft.title,
			draftKind: draft.kind,
			editedAt: draft.editedAt ? new Date(draft.editedAt) : undefined
		}));

		return [...storyRecords, ...draftRecords].sort(
			(a, b) => (b.editedAt?.getTime() ?? 0) - (a.editedAt?.getTime() ?? 0)
		);
	}, [drafts, stories]);

	return {records, hasDrafts: drafts !== undefined, loading, refresh};
}
