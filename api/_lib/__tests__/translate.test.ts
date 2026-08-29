/**
 * 서버 코드라 node 환경에서 돈다(jsdom에는 SDK가 쓰는 TextEncoder가 없다).
 *
 * @jest-environment node
 */
import {
	escapeProseUnderscores,
	findInvalidVarNames,
	repairHarloweIdentifiers,
	repairStartPassage,
	romanizeVariableNames,
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
		const twee = `${HEAD}\n:: 시작\n(set: $evidence to true, $hand to it + 1)(if: $evidence is not false)[네]\n`;

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

// 한글 변수명은 Harlowe 변수 패턴에 없어서 "$용기 to " isn't valid Harlowe syntax
// for the inside of a macro call로 터진다. 이름만 로마자로 갈고 문장은 그대로 둔다.
describe('romanizeVariableNames', () => {
	it('한글 변수명을 로마자로 바꾸고 모든 등장 위치를 함께 고친다', () => {
		const twee = '(set: $용기 to 0)\n(if: $용기 > 1)[용기를 냈다]';
		expect(romanizeVariableNames(twee)).toBe(
			'(set: $yonggi to 0)\n(if: $yonggi > 1)[용기를 냈다]'
		);
	});

	it('본문 문장의 한글은 건드리지 않는다', () => {
		const prose = '용기가 필요했다. 동료는 없었다.';
		expect(romanizeVariableNames(prose)).toBe(prose);
	});

	it('임시변수와 정상 ASCII 변수를 구별해 다룬다', () => {
		expect(
			romanizeVariableNames('(set: _이름 to "진")(set: $has_key to true)')
		).toBe('(set: _ireum to "진")(set: $has_key to true)');
	});

	it('로마자가 겹치면 이름을 나눠 붙인다', () => {
		const out = romanizeVariableNames('(set: $용기 to 0, $yonggi to 1)');
		expect(out).toContain('$yonggi to 1');
		expect(out).toContain('$yonggi2 to 0');
	});

	it('금액 표기 $500원은 변수가 아니라 그대로 둔다', () => {
		expect(romanizeVariableNames('값은 $500원이다.')).toBe('값은 $500원이다.');
	});
});

// 본문의 `Q4_final_real`을 Harlowe가 임시변수 참조로 읽어
// "There isn't a temp variable named _final_real in this place."로 터지던 것.
describe('escapeProseUnderscores', () => {
	it('낱말 뒤에 붙은 밑줄을 글자로 보이게 바꾼다', () => {
		expect(escapeProseUnderscores('이름은 "Q4_final_real".')).toBe(
			'이름은 "Q4&#95;final&#95;real".'
		);
	});

	// 밑줄 앞이 한글이어도 Harlowe에는 `_v7` 참조로 보인다(ASCII \\w로 판단하면 놓친다).
	it('한글 낱말 뒤에 붙은 밑줄도 잡는다', () => {
		expect(escapeProseUnderscores('「FY_실제_대조_v7 (열람제한)」')).toBe(
			'「FY_실제_대조&#95;v7 (열람제한)」'
		);
	});

	it('문장 안에 홀로 선 임시변수 참조는 그대로 둔다', () => {
		expect(escapeProseUnderscores('남은 값은 _flag 하나였다.')).toBe(
			'남은 값은 _flag 하나였다.'
		);
	});

	it('매크로 안의 밑줄과 링크 대상은 건드리지 않는다', () => {
		const twee = '(go-to: "chapter_one")\n[[가자->chapter_one]]';
		expect(escapeProseUnderscores(twee)).toBe(twee);
	});

	it('정상 변수 토큰과 구절 제목은 건드리지 않는다', () => {
		const twee = ':: my_passage\n$has_key와 _tmp_flag는 그대로.';
		expect(escapeProseUnderscores(twee)).toBe(twee);
	});
});

describe('repairHarloweIdentifiers / validateTwee', () => {
	it('검증이 못 읽는 변수 이름을 지목한다', () => {
		expect(findInvalidVarNames('(set: $용기 to 0)')).toEqual(['$용기']);
		expect(
			validateTwee(`${HEAD}\n:: 시작\n(set: $용기 to 0)본문.\n`).join()
		).toContain('$용기');
	});

	it('보정을 거치면 변수 이름 문제가 남지 않는다', () => {
		const twee = `${HEAD}\n:: 시작\n(set: $용기 to 0)폴더 "Q4_final_real"을 본다.\n`;
		const fixed = repairHarloweIdentifiers(twee);
		expect(findInvalidVarNames(fixed)).toEqual([]);
		expect(validateTwee(fixed)).toEqual([]);
		expect(fixed).toContain('Q4&#95;final&#95;real');
	});
});
