import {act, render, screen, waitFor} from '@testing-library/react';
import {createHashHistory} from 'history';
import * as React from 'react';
import {HashRouter, Route} from 'react-router-dom';
import {usePublishing} from '../../../store/use-publishing';
import {STORY_MESSAGE_SOURCE} from '../../../components/story-player/story-message-bridge';
import {setRetroLinkForStory} from '../../../util/retro-link';
import {StoryPlayRoute} from '../story-play-route';

jest.mock('../../../store/use-publishing');

describe('<StoryPlayRoute>', () => {
	const usePublishingMock = usePublishing as jest.Mock;

	function renderComponent(route: string) {
		const history = createHashHistory();

		history.push(route);
		return render(
			<HashRouter>
				<Route path="/stories/:storyId/play">
					<StoryPlayRoute />
				</Route>
			</HashRouter>
		);
	}

	function storyFrame() {
		return document.querySelector('iframe.sandboxed-story-player');
	}

	// 브리지가 부모로 보내는 postMessage를 흉내낸다. 리스너는 발신 window가 그 iframe인지
	// 확인하므로, event.source를 iframe의 contentWindow로 맞춰 직접 dispatch한다.
	function sendStoryMessage(text: string) {
		const frame = storyFrame() as HTMLIFrameElement;
		const event = new MessageEvent('message', {
			data: {source: STORY_MESSAGE_SOURCE, text}
		});

		Object.defineProperty(event, 'source', {value: frame.contentWindow});
		act(() => {
			window.dispatchEvent(event);
		});
	}

	beforeEach(() => {
		window.localStorage.clear();
	});

	it('replaces the DOM with a playable version of the story in :storyId', async () => {
		const publishStory = jest.fn(() => Promise.resolve('mock-published-story'));

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/play');
		await waitFor(() =>
			expect(storyFrame()?.getAttribute('srcdoc')).toBe('mock-published-story')
		);
		expect(publishStory.mock.calls).toEqual([['123']]);
	});

	it('shows an error message if publishing fails', async () => {
		const publishStory = jest.fn(() =>
			Promise.reject(new Error('mock-error-message'))
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/play');
		await waitFor(() =>
			expect(document.body.textContent).toContain('mock-error-message')
		);
	});

	it('leaves the story untouched when it has no linked retro page', async () => {
		const publishStory = jest.fn(() =>
			Promise.resolve('<body>mock-published-story</body>')
		);

		usePublishingMock.mockReturnValue({publishStory});
		renderComponent('/stories/123/play');
		await waitFor(() => expect(storyFrame()).not.toBeNull());
		expect(storyFrame()?.getAttribute('srcdoc')).not.toContain(
			STORY_MESSAGE_SOURCE
		);
	});

	describe('when the story came from a Notion retro', () => {
		const fetchMock = jest.fn();

		beforeEach(() => {
			setRetroLinkForStory('123', {pageId: 'page-1', title: '7주차 회고'});
			usePublishingMock.mockReturnValue({
				publishStory: jest.fn(() =>
					Promise.resolve('<body>mock-published-story</body>')
				)
			});
			(global as any).fetch = fetchMock;
		});

		it('injects the message bridge', async () => {
			renderComponent('/stories/123/play');
			await waitFor(() =>
				expect(storyFrame()?.getAttribute('srcdoc')).toContain(
					STORY_MESSAGE_SOURCE
				)
			);
		});

		it('saves a message from the story to its Notion page', async () => {
			fetchMock.mockResolvedValue({ok: true, json: () => Promise.resolve({})});
			renderComponent('/stories/123/play');
			await waitFor(() => expect(storyFrame()).not.toBeNull());

			sendStoryMessage('  그때의 너에게  ');

			await waitFor(() =>
				expect(screen.getByText(/7주차 회고.*도착/)).toBeInTheDocument()
			);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
				pageId: 'page-1',
				message: '그때의 너에게'
			});
		});

		it('does not save the same message twice', async () => {
			fetchMock.mockResolvedValue({ok: true, json: () => Promise.resolve({})});
			renderComponent('/stories/123/play');
			await waitFor(() => expect(storyFrame()).not.toBeNull());

			sendStoryMessage('한마디');
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			sendStoryMessage('한마디');
			await waitFor(() => expect(screen.getByText(/도착/)).toBeInTheDocument());
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('reports a failed save and allows retrying it', async () => {
			fetchMock.mockResolvedValue({
				ok: false,
				status: 401,
				json: () => Promise.resolve({error: 'not connected'})
			});
			renderComponent('/stories/123/play');
			await waitFor(() => expect(storyFrame()).not.toBeNull());

			sendStoryMessage('한마디');
			await waitFor(() =>
				expect(screen.getByText(/not connected/)).toBeInTheDocument()
			);

			// 같은 글이라도 실패했으면 다시 시도할 수 있어야 한다.
			fetchMock.mockResolvedValue({ok: true, json: () => Promise.resolve({})});
			sendStoryMessage('한마디');
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		});
	});
});
