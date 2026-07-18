import * as React from 'react';
import {useParams} from 'react-router-dom';
import {usePublishing} from '../../store/use-publishing';
import {SandboxedStoryPlayer} from '../../components/story-player';

export const StoryProofRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {proofStory} = usePublishing();
	const publish = React.useCallback(
		() => proofStory(storyId),
		[proofStory, storyId]
	);

	return <SandboxedStoryPlayer publish={publish} />;
};
