import {chromium} from '@playwright/test';

const base = 'http://localhost:5173';
const seedId = 'restore-test-002';
const seedTwee = [
	':: StoryTitle',
	'Restored Story',
	'',
	':: StoryData',
	'{"ifid":"RESTORE-IFID","format":"Harlowe","format-version":"3.3.9","start":"Start"}',
	'',
	':: Start {"position":"25,25","size":"100,100"}',
	'Restored passage text.',
	''
].join('\n');

async function api(method, path, body) {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {'Content-Type': 'application/json'},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return response.json();
}

await api('PUT', `/__notion-sync/stories/${seedId}`, {
	name: 'Restored Story',
	ifid: 'RESTORE-IFID',
	twee: seedTwee
});
const idsBefore = (await api('GET', '/__notion-sync/stories')).map(
	story => story.storyId
);
console.log('seeded; stories before test:', idsBefore.join(', '));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', message => {
	if (/notion/i.test(message.text())) {
		console.log('browser console:', message.text());
	}
});
await page.goto(base, {timeout: 60000});

// First run shows the welcome flow; skip it. Cold compiles can be slow, so
// wait generously for either the welcome screen or the library to appear.
const skip = page.getByRole('button', {name: /Skip|건너뛰기/});
const restored = page.getByText('Restored Story').first();
await Promise.race([
	skip.waitFor({timeout: 60000}),
	restored.waitFor({timeout: 60000})
]);

if (await skip.isVisible().catch(() => false)) {
	await skip.click();
	console.log('skipped welcome');
}

// Restore path: the seeded story should appear in the library.
await restored.waitFor({timeout: 30000});
console.log('RESTORE OK: story from Notion appears in library');

// Create path: make a new story via UI, then wait past the sync debounce.
await page.getByRole('button', {name: /^New$|새 스토리/}).click();
await page.getByRole('button', {name: /^Create$|창작/}).click();
await page.waitForURL(/stories\//, {timeout: 10000});
console.log('created story via UI, waiting for debounced sync...');
await page.waitForTimeout(8000);

const idsAfter = (await api('GET', '/__notion-sync/stories')).map(
	story => story.storyId
);
const newIds = idsAfter.filter(id => !idsBefore.includes(id));
console.log('new stories in Notion:', newIds.join(', ') || '(none)');

if (newIds.length === 1) {
	console.log('SYNC OK: new story was pushed to Notion');
} else {
	console.log('SYNC FAILED');
	process.exitCode = 1;
}

// Pull path: edit the story's Notion copy directly (as Claude would), then
// reload. The merge-on-load should prefer the newer Notion copy even though
// the story exists in local storage.
if (newIds.length === 1) {
	const renamedTwee = [
		':: StoryTitle',
		'Renamed In Notion',
		'',
		':: StoryData',
		'{"ifid":"RENAME-IFID","format":"Harlowe","format-version":"3.3.9","start":"Start"}',
		'',
		':: Start {"position":"25,25","size":"100,100"}',
		'Edited directly in Notion.',
		''
	].join('\n');

	// Notion truncates timestamps to the minute, so a same-minute local edit
	// would win the merge. Backdate the local copy to make the test
	// deterministic; in real use the Notion edit happens minutes later anyway.
	await page.evaluate(id => {
		const key = `twine-stories-${id}`;
		const story = JSON.parse(window.localStorage.getItem(key));

		story.lastUpdate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		window.localStorage.setItem(key, JSON.stringify(story));
	}, newIds[0]);

	await api('PUT', `/__notion-sync/stories/${newIds[0]}`, {
		name: 'Renamed In Notion',
		ifid: 'RENAME-IFID',
		twee: renamedTwee
	});
	await page.goto(base, {timeout: 60000});
	await page
		.getByText('Renamed In Notion')
		.first()
		.waitFor({timeout: 30000});
	console.log('PULL OK: Notion edit appeared in library after reload');
}

// Clean up only the stories this test created. Never touch anything else --
// real stories may be syncing to the same database.
for (const id of [seedId, ...newIds]) {
	await api('DELETE', `/__notion-sync/stories/${id}`);
}
console.log('cleaned up test stories');

await browser.close();
