import {toHaveNoViolations} from 'jest-axe';
import {configure} from '@testing-library/dom';
import '@testing-library/jest-dom';
import 'jest-canvas-mock';

// Always mock these files so that Jest doesn't see import.meta.

jest.mock('./util/i18n');

// Mock this component so that we don't get spurious errors around needing
// focusable elements, because often we're mocking contents.

jest.mock('focus-trap-react');

configure({asyncUtilTimeout: 5000});

expect.extend(toHaveNoViolations);

// api/ 쪽 서버 코드 테스트는 node 환경에서 돈다(@jest-environment node) — 거기엔
// window가 없으니 아래 jsdom 보정은 건너뛴다.

const hasWindow = typeof window !== 'undefined';

// jsdom doesn't implement window.matchMedia, but TS knows about it, so we
// have to do some hacky stuff here.

beforeEach(() => {
	if (hasWindow) {
		(window as any).matchMedia = jest.fn(() => ({
			addEventListener: jest.fn(),
			matches: false,
			removeEventListener: jest.fn()
		}));
	}
});
afterEach(() => {
	if (hasWindow) {
		delete (window as any).matchMedia;
	}
});

// jsdom also doesn't implement pointer events properly.
// see https://github.com/testing-library/dom-testing-library/issues/558

if (hasWindow) {
	(window as any).PointerEvent = class FakePointerEvent extends Event {
		constructor(type: string, props: Record<string, unknown>) {
			super(type, props);

			for (const propName of [
				'button',
				'clientX',
				'clientY',
				'pointerType',
				'shiftKey'
			]) {
				if (props[propName] !== null) {
					(this as any)[propName] = props[propName];
				}
			}
		}
	};

	window.Element.prototype.releasePointerCapture = () => {};
	window.Element.prototype.setPointerCapture = () => {};
}
