import {mergeRemoteStories, RemoteStory} from '..';
import {Story} from '../../../stories';
import {storyFromTwee} from '../../../../util/twee';

const TWEE = [
	':: StoryTitle',
	'Merge Test',
	'',
	':: StoryData',
	'{"ifid":"MERGE-IFID","format":"Harlowe","format-version":"3.3.9","start":"Start"}',
	'',
	':: Start {"position":"25,25","size":"100,100"}',
	'Original text.',
	''
].join('\n');
const EDITED_TWEE = TWEE.replace('Original text.', 'Edited in Notion.');

function localStory(twee: string, id: string, lastUpdate: Date): Story {
	const story = storyFromTwee(twee);

	return {
		...story,
		id,
		lastUpdate,
		passages: story.passages.map(passage => ({...passage, story: id}))
	};
}

function fakeRemote(props: Partial<RemoteStory> = {}): RemoteStory {
	return {
		lastEdited: null,
		lastSynced: null,
		storyId: 'story-1',
		twee: TWEE,
		...props
	};
}

describe('mergeRemoteStories', () => {
	it('adds stories that only exist in Notion', () => {
		const result = mergeRemoteStories(
			[],
			[fakeRemote({lastSynced: '2026-07-08T00:00:00Z'})]
		);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('story-1');
		expect(result[0].name).toBe('Merge Test');
		expect(result[0].passages[0].text).toBe('Original text.');
		expect(result[0].lastUpdate).toEqual(new Date('2026-07-08T00:00:00Z'));
	});

	it('leaves a story alone when the Notion copy has identical content, even if its timestamp is newer', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({lastSynced: '2026-07-08T00:00:00Z'})]
		);

		expect(result).toEqual([local]);
	});

	it('pulls the Notion copy when its content differs and it is newer', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-08T09:00:00Z'})]
		);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('story-1');
		expect(result[0].passages[0].text).toBe('Edited in Notion.');
		expect(result[0].lastUpdate).toEqual(new Date('2026-07-08T09:00:00Z'));
	});

	it('keeps the local copy when it is newer than a differing Notion copy', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-08T09:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[fakeRemote({twee: EDITED_TWEE, lastSynced: '2026-07-01T00:00:00Z'})]
		);

		expect(result).toEqual([local]);
	});

	it('uses the later of lastEdited and lastSynced as the Notion timestamp', () => {
		const local = localStory(TWEE, 'story-1', new Date('2026-07-01T00:00:00Z'));
		const result = mergeRemoteStories(
			[local],
			[
				fakeRemote({
					twee: EDITED_TWEE,
					lastEdited: '2026-07-08T09:00:00Z',
					lastSynced: '2026-06-01T00:00:00Z'
				})
			]
		);

		expect(result[0].passages[0].text).toBe('Edited in Notion.');
	});

	it('skips Notion stories whose twee cannot be parsed', () => {
		const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

		try {
			const local = localStory(
				TWEE,
				'story-1',
				new Date('2026-07-01T00:00:00Z')
			);
			const result = mergeRemoteStories(
				[local],
				[fakeRemote({storyId: 'story-2', twee: ':: \nbroken'})]
			);

			expect(result).toEqual([local]);
		} finally {
			warnSpy.mockRestore();
		}
	});
});
