// Keeps the running app in step with changes made to stories outside it--in
// practice, edits Claude or a person makes to the Notion mirror (see
// persistence/notion-sync). Notion has no webhook we can subscribe to here, so
// someone has to ask; doing the asking on the client means dev server and
// deployed builds share one implementation.
//
// The poll itself is cheap: persistence.pullRemote only reads story bodies once
// a timestamps-only listing shows something actually moved.

import * as React from 'react';
import {usePersistence} from './persistence/use-persistence';
import {useStoriesContext} from './stories';

export const PULL_INTERVAL_MS = 5000;

export function useNotionSyncPull(enabled: boolean) {
	const {dispatch, stories} = useStoriesContext();
	const {stories: persistence} = usePersistence();

	// Held in a ref so that changing stories doesn't restart the interval--
	// otherwise every keystroke would reset the timer and a poll would never fire
	// while the user was typing.

	const storiesRef = React.useRef(stories);

	React.useEffect(() => {
		storiesRef.current = stories;
	}, [stories]);

	const pull = React.useCallback(async () => {
		const {pullRemote} = persistence;

		// Nothing to gain from polling a tab nobody is looking at. Becoming
		// visible triggers a pull of its own, below.

		if (!pullRemote || document.visibilityState !== 'visible') {
			return;
		}

		try {
			const {changed, stories: merged} = await pullRemote(storiesRef.current);

			// 'init' is the one action that replaces state wholesale without the
			// save middleware writing anything--which is what we want here, since
			// pullRemote has already persisted the merge. It also means no push back
			// to Notion, so pulling can't echo.

			if (changed) {
				dispatch({type: 'init', state: merged});
			}
		} catch (error) {
			console.warn('Pulling story changes failed', error);
		}
	}, [dispatch, persistence]);

	React.useEffect(() => {
		if (!enabled) {
			return;
		}

		const interval = window.setInterval(pull, PULL_INTERVAL_MS);

		// Coming back to the app is the moment the user is most likely to be
		// waiting on a change made elsewhere, so don't make them wait out the
		// interval.

		window.addEventListener('focus', pull);
		document.addEventListener('visibilitychange', pull);

		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', pull);
			document.removeEventListener('visibilitychange', pull);
		};
	}, [enabled, pull]);
}
