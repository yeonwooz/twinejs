import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {Routes} from '..';
import {createHashHistory} from 'history';
import {PrefsContext, PrefsContextProps} from '../../store/prefs';
import {fakePrefs} from '../../test-util';

jest.mock('../home/home-route');
jest.mock('../make/make-route');
jest.mock('../story-edit/story-edit-route');
jest.mock('../story-list/story-list-route');
jest.mock('../story-play/story-play-route');
jest.mock('../story-proof/story-proof-route');
jest.mock('../story-test/story-test-route');
jest.mock('../welcome/welcome-route');

describe('<Routes>', () => {
	function renderAtRoute(route: string, context?: Partial<PrefsContextProps>) {
		const history = createHashHistory();

		history.push(route);
		return render(
			<PrefsContext.Provider
				value={{
					dispatch: jest.fn(),
					prefs: fakePrefs({welcomeSeen: true}),
					...context
				}}
			>
				<Routes />
			</PrefsContext.Provider>
		);
	}

	// 첫 로딩에 웰컴 투어를 강제하지 않는다 — 바로 홈으로 보내고, 웰컴은 /welcome으로만
	// 간다. 예전에는 welcomeSeen이 모든 경로를 가로챘다.
	describe("when the user doesn't have a welcomeSeen pref", () => {
		it('still renders the requested route', () => {
			renderAtRoute('/stories/123', {
				dispatch: jest.fn(),
				prefs: fakePrefs({welcomeSeen: false})
			});
			expect(screen.getByTestId('mock-story-edit-route')).toBeInTheDocument();
		});
	});

	describe('when the user has a welcomeSeen pref', () => {
		it('renders the story edit route at /stories/:id', () => {
			renderAtRoute('/stories/123');
			expect(screen.getByTestId('mock-story-edit-route')).toBeInTheDocument();
		});

		// 홈은 기록(작문대 + 연대기)이다. Twine 원래 카드 목록은 /stories로 내려갔다.
		it('renders the home route at /', () => {
			renderAtRoute('/');
			expect(screen.getByTestId('mock-home-route')).toBeInTheDocument();
		});

		it('renders the story list at /stories', () => {
			renderAtRoute('/stories');
			expect(screen.getByTestId('mock-story-list-route')).toBeInTheDocument();
		});

		it('renders the make route at /make/:pageId', () => {
			renderAtRoute('/make/page-1');
			expect(screen.getByTestId('mock-make-route')).toBeInTheDocument();
		});

		// 예전 위저드 주소를 북마크해 둔 사람을 홈으로 흘려보낸다.
		it.each(['/retro', '/scenario'])('redirects %s to home', route => {
			renderAtRoute(route);
			expect(screen.getByTestId('mock-home-route')).toBeInTheDocument();
		});

		it('renders the story play route at /stories/:id/play', () => {
			renderAtRoute('/stories/123/play');
			expect(screen.getByTestId('mock-story-play-route')).toBeInTheDocument();
		});

		it('renders the story proof route at /stories/:id/proof', () => {
			renderAtRoute('/stories/123/proof');
			expect(screen.getByTestId('mock-story-proof-route')).toBeInTheDocument();
		});

		it('renders the story test route at /stories/:id/test', () => {
			renderAtRoute('/stories/123/test');
			expect(screen.getByTestId('mock-story-test-route')).toBeInTheDocument();
		});

		it('renders the story test route at /stories/:storyId/test/:passageId', () => {
			renderAtRoute('/stories/123/test/456');
			expect(screen.getByTestId('mock-story-test-route')).toBeInTheDocument();
		});

		it('renders the welcome route at /welcome', () => {
			renderAtRoute('/welcome');
			expect(screen.getByTestId('mock-welcome-route')).toBeInTheDocument();
		});

		it('renders the home route for unknown routes', () => {
			jest.spyOn(console, 'warn').mockReturnValue();
			renderAtRoute('/unknown-route');
			expect(screen.getByTestId('mock-home-route')).toBeInTheDocument();
		});
	});
});
