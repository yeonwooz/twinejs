import * as React from 'react';
import {useParams} from 'react-router-dom';
import {usePublishing} from '../../store/use-publishing';
import {SandboxedStoryPlayer} from '../../components/story-player';

export const StoryPlayRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {publishStory} = usePublishing();
	const publish = React.useCallback(
		() => publishStory(storyId),
		[publishStory, storyId]
	);

	return <SandboxedStoryPlayer publish={publish} />;
};
