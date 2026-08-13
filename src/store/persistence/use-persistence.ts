import * as React from 'react';
import {useElectronIpcPersistence} from './electron-ipc/use-electron-ipc-persistence';
import {useLocalStoragePersistence} from './local-storage/use-local-storage-persistence';
import {isElectronRenderer} from '../../util/is-electron';
import {StoriesAction, StoriesState} from '../stories';
import {StoryFormatsAction, StoryFormatsState} from '../story-formats';
import {PrefsAction, PrefsState} from '../prefs';

export interface PersistenceHooks {
	prefs: {
		load: () => Promise<Partial<PrefsState>>;
		saveMiddleware: (state: PrefsState, action: PrefsAction) => void;
	};
	stories: {
		load: () => Promise<StoriesState>;
		/**
		 * Pulls changes made to the backing store since the last look, if the
		 * backend has one that others can write to. Absent for backends where
		 * this app is the only writer, e.g. Electron.
		 */
		pullRemote?: (current: StoriesState) => Promise<{
			stories: StoriesState;
			changed: boolean;
		}>;
		saveMiddleware: (
			state: StoriesState,
			action: StoriesAction,
			formats: StoryFormatsState
		) => void;
	};
	storyFormats: {
		load: () => Promise<StoryFormatsState>;
		saveMiddleware: (
			state: StoryFormatsState,
			action: StoryFormatsAction
		) => void;
	};
}

export function usePersistence(): PersistenceHooks {
	const electronIpcPersistence = useElectronIpcPersistence();
	const localStoragePersistence = useLocalStoragePersistence();

	return React.useMemo(
		() =>
			isElectronRenderer() ? electronIpcPersistence : localStoragePersistence,
		[electronIpcPersistence, localStoragePersistence]
	);
}
