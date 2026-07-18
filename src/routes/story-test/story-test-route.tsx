import * as React from 'react';
import {useParams} from 'react-router-dom';
import {usePublishing} from '../../store/use-publishing';
import {SandboxedStoryPlayer} from '../../components/story-player';

export const StoryTestRoute: React.FC = () => {
	const {passageId, storyId} = useParams<{
		passageId: string;
		storyId: string;
	}>();
	const {publishStory} = usePublishing();
	const publish = React.useCallback(
		() => publishStory(storyId, {formatOptions: 'debug', startId: passageId}),
		[passageId, publishStory, storyId]
	);

	return <SandboxedStoryPlayer publish={publish} />;
};
