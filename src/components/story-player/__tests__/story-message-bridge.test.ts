import {waitFor} from '@testing-library/react';
import {
	injectMessageBridge,
	STORY_MESSAGE_SOURCE
} from '../story-message-bridge';

describe('injectMessageBridge()', () => {
	it('inserts the script just before the closing body tag', () => {
		const result = injectMessageBridge(
			'<html><body><tw-story></tw-story></body></html>'
		);

		expect(result.indexOf('<script>')).toBeGreaterThan(
			result.indexOf('<tw-story>')
		);
		expect(result.indexOf('<script>')).toBeLessThan(result.indexOf('</body>'));
		expect(result).toContain(STORY_MESSAGE_SOURCE);
	});

	it('appends the script when there is no body tag', () => {
		const result = injectMessageBridge('mock-published-story');

		expect(result.startsWith('mock-published-story')).toBe(true);
		expect(result).toContain(STORY_MESSAGE_SOURCE);
	});

	it('uses the last closing body tag, not the first', () => {
		const result = injectMessageBridge('<body>a</body><body>b</body>').replace(
			/<script>[\s\S]*?<\/script>/,
			'[bridge]'
		);

		expect(result).toBe('<body>a</body><body>b[bridge]</body>');
	});
});

// 브리지는 문자열로 주입돼 iframe 안에서만 도는 코드라 타입 검사도 번들도 거치지
// 않는다. 실제로 실행해 동작을 확인한다. jsdom에서는 window.parent === window라
// window.postMessage를 감시하면 브리지가 부모로 보내는 걸 잡을 수 있다.
describe('bridge script', () => {
	const script = injectMessageBridge('<body></body>').replace(
		/^[\s\S]*<script>([\s\S]*)<\/script>[\s\S]*$/,
		'$1'
	);
	let posted: jest.SpyInstance;

	beforeAll(() => {
		// eslint-disable-next-line no-new-func
		new Function(script)();
	});

	beforeEach(() => {
		document.body.innerHTML = '';
		posted = jest.spyOn(window.parent, 'postMessage').mockImplementation();
	});

	function typeInto(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
		el.value = text;
		el.dispatchEvent(new Event('input', {bubbles: true}));
	}

	it('sends the text once the input leaves the DOM (= the passage advanced)', async () => {
		const area = document.createElement('textarea');

		document.body.appendChild(area);
		typeInto(area, '  그때의 너에게  ');
		expect(posted).not.toHaveBeenCalled(); // 아직 구절을 안 넘겼다.

		area.remove();

		await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
		expect(posted.mock.calls[0][0]).toEqual({
			source: STORY_MESSAGE_SOURCE,
			text: '그때의 너에게'
		});
	});

	it('ignores single-line inputs, which are usually name prompts', async () => {
		const input = document.createElement('input');

		document.body.appendChild(input);
		typeInto(input, '수연');
		input.remove();

		await new Promise(resolve => setTimeout(resolve, 0));
		expect(posted).not.toHaveBeenCalled();
	});

	it('does not resend unchanged text when a later passage also has an input', async () => {
		const first = document.createElement('textarea');

		document.body.appendChild(first);
		typeInto(first, '한마디');
		first.remove();
		await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));

		const second = document.createElement('textarea');

		document.body.appendChild(second);
		typeInto(second, '한마디');
		second.remove();

		await new Promise(resolve => setTimeout(resolve, 0));
		expect(posted).toHaveBeenCalledTimes(1);
	});
});
