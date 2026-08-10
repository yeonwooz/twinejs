import * as React from 'react';
import {useParams} from 'react-router-dom';
import {usePublishing} from '../../store/use-publishing';
import {SandboxedStoryPlayer} from '../../components/story-player';
import {retroLinkForStory} from '../../util/retro-link';

export const StoryPlayRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {publishStory} = usePublishing();
	const publish = React.useCallback(
		() => publishStory(storyId),
		[publishStory, storyId]
	);

	// 회고에서 만들어진 스토리라면 메시지를 되돌려보낼 Notion 페이지를 안다.
	const retroLink = React.useMemo(() => retroLinkForStory(storyId), [storyId]);
	const [notice, setNotice] = React.useState<string>();
	const savedRef = React.useRef<string | undefined>(undefined);

	// 스토리 안 "그때의 나에게" 입력칸에 쓴 글을 그 회고의 Notion 페이지에 붙인다.
	// 브리지는 구절이 넘어갈 때마다 부를 수 있어, 같은 글을 두 번 저장하지 않도록 막는다.
	const saveMessage = React.useCallback(
		async (text: string) => {
			if (!retroLink || text === savedRef.current) {
				return;
			}

			savedRef.current = text;
			setNotice('🌌 메시지를 시공 너머로 보내는 중…');

			try {
				const response = await fetch('/api/notion/draft', {
					method: 'POST',
					credentials: 'same-origin',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({pageId: retroLink.pageId, message: text})
				});

				if (!response.ok) {
					const body = await response.json().catch(() => undefined);

					throw new Error(body?.error ?? `요청 실패 (${response.status})`);
				}

				setNotice(
					retroLink.title
						? `🌌 메시지가 '${retroLink.title}'에 도착했어요.`
						: '🌌 메시지가 Notion 회고 페이지에 도착했어요.'
				);
			} catch (error) {
				savedRef.current = undefined; // 다음 시도를 막지 않는다.
				setNotice(
					`메시지를 Notion에 저장하지 못했어요 — ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		},
		[retroLink]
	);

	return (
		<SandboxedStoryPlayer
			publish={publish}
			onStoryMessage={retroLink ? saveMessage : undefined}
			notice={notice}
		/>
	);
};
