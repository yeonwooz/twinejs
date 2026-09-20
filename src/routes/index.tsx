import * as React from 'react';
import {HashRouter, Redirect, Route, Switch} from 'react-router-dom';
import {HomeRoute} from './home';
import {MakeRoute} from './make';
import {StoryEditRoute} from './story-edit';
import {StoryListRoute} from './story-list';
import {StoryPlayRoute} from './story-play';
import {StoryProofRoute} from './story-proof';
import {StoryTestRoute} from './story-test';
import {WelcomeRoute} from './welcome';

export const Routes: React.FC = () => {
	// A <HashRouter> is used to make our lives easier--to load local story
	// formats, we need the document HREF to reflect where the HTML file is.
	// Otherwise we'd have to store the actual location somewhere, which will
	// differ between web and Electron contexts.

	// 홈은 기록(작문대 + 연대기)이다. Twine 원래의 스토리 카드 목록은 /stories로
	// 내려갔다 — 편집기·라이브러리·빌드 기능은 그대로 살아 있다.
	// 웰컴은 /welcome 경로로 여전히 접근 가능.

	return (
		<HashRouter>
			<Switch>
				<Route exact path="/">
					<HomeRoute />
				</Route>
				<Route exact path="/stories">
					<StoryListRoute />
				</Route>
				<Route path="/welcome">
					<WelcomeRoute />
				</Route>
				<Route path="/make/:pageId">
					<MakeRoute />
				</Route>
				{/* 예전 위저드 주소. 북마크나 옛 링크를 홈으로 흘려보낸다. */}
				<Redirect from="/retro" to="/" />
				<Redirect from="/scenario" to="/" />
				<Route path="/stories/:storyId/play">
					<StoryPlayRoute />
				</Route>
				<Route path="/stories/:storyId/proof">
					<StoryProofRoute />
				</Route>
				<Route path="/stories/:storyId/test/:passageId">
					<StoryTestRoute />
				</Route>
				<Route path="/stories/:storyId/test">
					<StoryTestRoute />
				</Route>
				<Route path="/stories/:storyId">
					<StoryEditRoute />
				</Route>
				<Route
					path="*"
					render={path => {
						console.warn(
							`No route for path "${path.location.pathname}", rendering home`
						);
						return <HomeRoute />;
					}}
				></Route>
			</Switch>
		</HashRouter>
	);
};
