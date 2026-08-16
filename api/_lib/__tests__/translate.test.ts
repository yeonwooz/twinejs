/**
 * 서버 코드라 node 환경에서 돈다(jsdom에는 SDK가 쓰는 TextEncoder가 없다).
 *
 * @jest-environment node
 */
import {
	repairStartPassage,
	stripEmptyMacros,
	validateTwee
} from '../translate';

const HEAD = [
	':: StoryTitle',
	'검증 테스트',
	'',
	':: StoryData',
	'{"ifid":"X","format":"Harlowe","format-version":"3.3.9","start":"시작"}',
	''
].join('\n');

// 재생할 때가 되어서야 Harlowe 문법 오류로 터지던 것 — 값이 빠진 매크로.
describe('validateTwee', () => {
	it('값이 빠진 (set:)을 잡는다', () => {
		const twee = `${HEAD}\n:: 시작\n(set: $증거 to )선택.\n`;

		expect(validateTwee(twee).join()).toContain('(set: $증거 to )');
	});

	it('(if: $x is ) 처럼 비교 값이 빠진 것도 잡는다', () => {
		const twee = `${HEAD}\n:: 시작\n(if: $신뢰 is )[네]\n`;

		expect(validateTwee(twee).join()).toContain('(if: $신뢰 is )');
	});

	it('멀쩡한 매크로는 문제로 보지 않는다', () => {
		const twee = `${HEAD}\n:: 시작\n(set: $증거 to true, $손 to it + 1)(if: $증거 is not false)[네]\n`;

		expect(validateTwee(twee)).toEqual([]);
	});
});

describe('stripEmptyMacros', () => {
	it('값이 빠진 매크로만 지우고 본문은 남긴다', () => {
		expect(stripEmptyMacros('(set: $증거 to )시계를 품었다.')).toBe(
			'시계를 품었다.'
		);
	});

	it('값이 있는 매크로는 건드리지 않는다', () => {
		const text = '(set: $증거 to true)시계를 품었다.';

		expect(stripEmptyMacros(text)).toBe(text);
	});
});

describe('repairStartPassage', () => {
	it('start가 실제 구절을 안 가리키면 첫 서사 구절로 고친다', () => {
		const twee = `${HEAD}\n:: 서재\n본문\n`;

		expect(repairStartPassage(twee)).toContain('"start": "서재"');
	});
});
