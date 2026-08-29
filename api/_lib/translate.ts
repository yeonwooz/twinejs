// 초안 → twee 번역 (서버측). scripts/retro.mjs의 translate/validate/withCosmicUI를 옮긴 것.
// 프롬프트·스타일시트는 scripts/의 파일을 단일 소스로 읽는다(vercel.json includeFiles로 번들).
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {EMPTY_USAGE, Provider, TokenUsage} from './models';

// adaptive thinking + effort를 지원하는 Anthropic 모델 판별. 모든 Opus(4.7+, 우리
// 드롭다운/기본값엔 그 이상만 노출)와 Sonnet 5·Fable 5가 해당. Haiku 4.5 등은 미지원이라
// thinking/effort를 생략한다(보내면 400). 최신 Opus를 런타임에 발견해도 커버되도록 접두사 사용.
function supportsAdaptive(model: string): boolean {
	return (
		model.startsWith('claude-opus-') ||
		model === 'claude-sonnet-5' ||
		model === 'claude-fable-5'
	);
}

function readScript(name: string): string {
	return readFileSync(path.join(process.cwd(), 'scripts', name), 'utf8');
}

const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['questions', 'twee', 'draftUpdate'],
	properties: {
		questions: {type: 'array', items: {type: 'string'}},
		twee: {type: 'string'},
		draftUpdate: {type: 'string'}
	}
};

// (set: $증거 to ) 처럼 값이 빠진 매크로. 재생할 때가 되어서야 Harlowe가
// "isn't valid Harlowe syntax for the inside of a macro call"로 터지므로,
// 검증에서 잡고(validateTwee) 끝내 안 고쳐지면 지운다(stripEmptyMacros).
const EMPTY_MACRO =
	/\((?:set|put|if|unless|else-if):[^)]*?\b(?:to|into|is)\s*\)/g;

// 구절 제목 줄에서 제목만 떼어낸다. twee3의 제목 줄은
// `:: 제목 [태그 태그] {"position":"100,200","size":"100,100"}` 꼴이라, 뒤에 붙는
// 메타데이터와 태그를 안 벗기면 링크 대상과 한 글자도 안 맞는다. Twine에서 내보낸
// twee에는 position이 늘 붙어 있어서, 그걸 다시 빚을 때 멀쩡한 구절이 전부 "끊긴
// 링크"로 잡혀 쓸데없는 LLM 재보정을 부르고 경고까지 띄웠다.
export function passageTitle(line: string): string {
	return line
		.replace(/\s*\{[^}]*\}\s*$/, '')
		.replace(/\s*\[[^\]]*\]\s*$/, '')
		.trim();
}

export function validateTwee(twee: string): string[] {
	const titles = new Set(
		[...twee.matchAll(/^:: (.+)$/gm)].map(m => passageTitle(m[1]))
	);
	// 백틱으로 감싼 곳은 Harlowe가 글자로만 출력한다 — 문법을 가르치는 구절의
	// `[[보이는 글->문단 이름]]` 예시를 링크로 세면 있지도 않은 "끊긴 링크"가 잡혀
	// 쓸데없는 LLM 재보정을 부른다.
	const linkable = twee.replace(/`[^`\n]*`/g, '');
	const links = [...linkable.matchAll(/\[\[[^\]]*?->([^\]]+)\]\]/g)].map(m =>
		m[1].trim()
	);
	const missing = links.filter(l => !titles.has(l));
	const sd = twee.match(/:: StoryData\n(\{[\s\S]*?\})/);
	let start: string | undefined;
	try {
		start = sd ? JSON.parse(sd[1]).start : undefined;
	} catch {
		/* ignore */
	}
	const emptyOperands = [...twee.matchAll(EMPTY_MACRO)].map(m => m[0]);
	const badNames = findInvalidVarNames(twee);

	const problems: string[] = [];
	if (missing.length)
		problems.push(`끊긴 링크: ${[...new Set(missing)].join(', ')}`);
	if (!start || !titles.has(start))
		problems.push(`StoryData.start "${start}" 구절 없음`);
	if (emptyOperands.length) {
		problems.push(
			`값이 빠진 매크로: ${[...new Set(emptyOperands)].join(', ')} — 값을 채우거나 그 매크로를 지워라`
		);
	}
	if (badNames.length) {
		problems.push(
			`Harlowe가 못 읽는 변수 이름: ${badNames.join(', ')} — 변수명은 ASCII 영문·숫자·밑줄만 쓴다(본문 문장은 한글 그대로 두고 이름만 바꿔라)`
		);
	}
	return problems;
}

// 최후의 보루. LLM 보정까지 거치고도 값이 빠진 매크로가 남으면 그 매크로만 지운다 —
// 변수 하나를 잃는 것보다 재생 자체가 문법 오류로 죽는 게 훨씬 나쁘다. 값을 지어내지는
// 않는다(무엇을 넣어야 할지는 이야기가 정하는 것이지 코드가 정할 일이 아니다).
export function stripEmptyMacros(twee: string): string {
	return twee.replace(EMPTY_MACRO, '');
}

// StoryData.start가 없거나 실제 구절을 안 가리키면 첫 서사 구절로 코드에서 지정한다.
// 이게 자동보정 재시도(LLM 1회 추가 호출)를 흔히 유발하는 문제라, 코드로 먼저 때워
// 비용을 아낀다. StoryData 블록 자체가 없거나 서사 구절이 없으면 손대지 않고 그대로 둔다.
export function repairStartPassage(twee: string): string {
	const sd = twee.match(/(:: StoryData\n)(\{[\s\S]*?\})/);
	if (!sd) return twee;

	// 제목만 떼어 쓴다. 메타데이터가 붙은 채로 start에 넣으면 시작 구절을 못 찾는
	// 값을 써넣어, 고치려던 것을 오히려 망가뜨린다.
	const narrative = [...twee.matchAll(/^:: (.+)$/gm)]
		.filter(m => !m[1].includes('[stylesheet]'))
		.map(m => passageTitle(m[1]))
		.filter(h => h !== 'StoryTitle' && h !== 'StoryData');
	if (!narrative.length) return twee;

	let data: any;
	try {
		data = JSON.parse(sd[2]);
	} catch {
		return twee;
	}
	if (data.start && narrative.includes(data.start)) return twee; // 이미 정상

	data.start = narrative[0];
	return twee.replace(sd[0], sd[1] + JSON.stringify(data, null, 2));
}

// ── Harlowe 식별자 보정 ─────────────────────────────────────────────────────
// Harlowe의 변수 이름 패턴에는 한글이 없다(ASCII 영숫자·밑줄과 일부 라틴 확장뿐).
// 그래서 `(set: $용기 to 0)`은 재생할 때가 되어서야
// "$용기 to " isn't valid Harlowe syntax for the inside of a macro call
// 으로 터진다. 값이 빠진 매크로와 같은 부류의 지연 실패라 같은 자리에서 코드로 때운다.
// 이름만 로마자로 갈고 본문 문장은 한 글자도 건드리지 않는다.

// 개정 로마자 표기의 뼈대만 따른다(연음·동화 규칙은 적용하지 않는다). 사람이 읽을 수
// 있는 이름을 만드는 게 목적이지 표기법 준수가 목적이 아니다.
const HANGUL_ONSETS = [
	'g',
	'kk',
	'n',
	'd',
	'tt',
	'r',
	'm',
	'b',
	'pp',
	's',
	'ss',
	'',
	'j',
	'jj',
	'ch',
	'k',
	't',
	'p',
	'h'
];
const HANGUL_NUCLEI = [
	'a',
	'ae',
	'ya',
	'yae',
	'eo',
	'e',
	'yeo',
	'ye',
	'o',
	'wa',
	'wae',
	'oe',
	'yo',
	'u',
	'wo',
	'we',
	'wi',
	'yu',
	'eu',
	'ui',
	'i'
];
const HANGUL_CODAS = [
	'',
	'k',
	'k',
	'k',
	'n',
	'n',
	'n',
	't',
	'l',
	'k',
	'm',
	'p',
	't',
	't',
	'p',
	'h',
	'm',
	'p',
	'p',
	't',
	't',
	'ng',
	't',
	't',
	'k',
	't',
	'p',
	't'
];

function romanize(name: string): string {
	let out = '';
	for (const ch of name) {
		const code = ch.codePointAt(0)!;
		if (code >= 0xac00 && code <= 0xd7a3) {
			const s = code - 0xac00;
			out +=
				HANGUL_ONSETS[Math.floor(s / 588)] +
				HANGUL_NUCLEI[Math.floor((s % 588) / 28)] +
				HANGUL_CODAS[s % 28];
		} else if (/[A-Za-z0-9_]/.test(ch)) {
			out += ch;
		}
	}
	return out;
}

// twee 안의 `$변수`·`_임시변수` 토큰. 앞에 낱말 글자가 붙은 밑줄은 변수가 아니라 본문
// 속 밑줄이므로(Q4_final_real) 여기서 잡지 않는다 — escapeProseUnderscores 담당.
const VAR_TOKEN = /(?<![\p{L}\p{N}_])([$_])([\p{L}\p{N}_]+)/gu;

const ASCII_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// 이름이 숫자로 시작하면 Harlowe도 변수로 읽지 않는다(본문의 `$500원` 같은 금액 표기).
function isVarName(name: string): boolean {
	return !/^\d/.test(name);
}

// Harlowe가 못 읽는 변수 이름들. 검증 메시지와 보정이 같은 판단을 쓰도록 함수로 뺀다.
export function findInvalidVarNames(twee: string): string[] {
	const bad = new Set<string>();
	for (const m of twee.matchAll(VAR_TOKEN)) {
		if (!ASCII_VAR_NAME.test(m[2]) && isVarName(m[2])) bad.add(m[1] + m[2]);
	}
	return [...bad];
}

export function romanizeVariableNames(twee: string): string {
	const taken = new Set<string>();
	for (const m of twee.matchAll(VAR_TOKEN)) {
		if (ASCII_VAR_NAME.test(m[2])) taken.add(m[2]);
	}

	// 같은 이름은 어디서나 같은 이름으로 바뀌어야 한다 — 표를 먼저 만들고 나서 치환한다.
	const renames = new Map<string, string>();
	for (const m of twee.matchAll(VAR_TOKEN)) {
		const name = m[2];
		if (ASCII_VAR_NAME.test(name) || !isVarName(name) || renames.has(name))
			continue;
		let base = romanize(name);
		if (!/^[A-Za-z_]/.test(base)) base = 'v' + base;
		let next = base;
		for (let i = 2; taken.has(next); i++) next = `${base}${i}`;
		taken.add(next);
		renames.set(name, next);
	}
	if (!renames.size) return twee;

	return twee.replace(VAR_TOKEN, (whole, sigil: string, name: string) =>
		renames.has(name) ? sigil + renames.get(name) : whole
	);
}

// 사용자 영역 문자 — 이야기 본문에 나올 일이 없어 자리표시자로 안전하다.
const MASK = '\uE000';

// 매크로 호출 안은 코드다. `(go-to: "chapter_1")`의 밑줄을 이스케이프하면 링크가
// 죽으므로 밑줄 처리에서 통째로 빼둔다(문자열 안의 괄호는 세지 않는다).

function maskMacroCalls(text: string): {masked: string; parts: string[]} {
	const parts: string[] = [];
	let out = '';
	let i = 0;
	while (i < text.length) {
		if (
			text[i] === '(' &&
			/^\([A-Za-z][\w-]*\s*:/.test(text.slice(i, i + 40))
		) {
			let depth = 0;
			let quote = '';
			let j = i;
			for (; j < text.length; j++) {
				const c = text[j];
				if (quote) {
					if (c === quote) quote = '';
					continue;
				}
				if (c === '"' || c === "'") quote = c;
				else if (c === '(') depth++;
				else if (c === ')' && --depth === 0) {
					j++;
					break;
				}
			}
			parts.push(text.slice(i, j));
			out += `${MASK}${parts.length - 1}${MASK}`;
			i = j;
		} else {
			out += text[i];
			i++;
		}
	}
	return {masked: out, parts};
}

// 본문에 `Q4_final_real`·`대조_v7`처럼 낱말 뒤에 밑줄이 붙으면 Harlowe가 `_final_real`을
// 임시변수 참조로 읽고 "There isn't a temp variable named _final_real in this place."로 터진다.
// 그 밑줄만 `&#95;`로 바꾼다 — 화면에는 똑같이 `_`로 보이므로, 혹시 변수가 아닌 곳을
// 건드려도 읽는 사람에게는 차이가 없다.
export function escapeProseUnderscores(twee: string): string {
	const {masked, parts} = maskMacroCalls(twee);
	const escaped = masked.replace(
		// 앞의 세 갈래는 통째로 지나칠 것들(구절 제목 줄, 링크, 정상 변수 토큰)이고
		// 마지막 갈래만 실제로 바꾼다.
		// 밑줄 앞 글자는 한글일 수도 있다 — `대조_v7`도 Harlowe에는 `_v7` 참조로 보이므로
		// 자릿수 판단에 \w(ASCII 전용)를 쓰면 놓친다. 유니코드 글자·숫자로 본다.
		/^:: .*$|\[\[[^\]]*\]\]|\$[A-Za-z_]\w*|(?<![\p{L}\p{N}])_[A-Za-z]\w*|([\p{L}\p{N}])_(?=[A-Za-z_])/gmu,
		(whole, before?: string) =>
			before === undefined ? whole : `${before}&#95;`
	);
	return escaped.replace(
		new RegExp(`${MASK}(\\d+)${MASK}`, 'g'),
		(_, n: string) => parts[+n]
	);
}

// LLM 재호출 없이 확실히 고칠 수 있는 Harlowe 식별자 문제를 코드로 먼저 때운다.
// 판단이 필요한 보정(끊긴 링크 등)은 여기서 하지 않는다.
export function repairHarloweIdentifiers(twee: string): string {
	return escapeProseUnderscores(romanizeVariableNames(twee));
}

function withThemeUI(twee: string, stylesheetFile: string): string {
	const css = readScript(stylesheetFile).trimEnd();
	const stripped = twee.replace(
		/\n:: [^\n]*\[stylesheet\][\s\S]*?(?=\n:: |\s*$)/g,
		''
	);
	return stripped.trimEnd() + '\n\n' + css + '\n';
}

export function withCosmicUI(twee: string): string {
	return withThemeUI(twee, 'cosmic-stylesheet.txt');
}

export function withScenarioUI(twee: string): string {
	return withThemeUI(twee, 'scenario-stylesheet.txt');
}

// 위저드 종류. retro는 회고→평행우주 번역, scenario는 구상→창작 시나리오.
// 프롬프트·스타일시트·문구가 갈리고 나머지 파이프라인은 같다.
export type WizardMode = 'retro' | 'scenario';

export interface TranslateInput {
	apiKey: string;
	provider: Provider;
	model: string;
	draftText: string;
	weekLabel: string;
	mode?: WizardMode;
	qa?: [string, string][];
	existingTwee?: string;
	feedback?: string;
}

// 모델이 구조화 출력으로 돌려주는 JSON(OUTPUT_SCHEMA와 같은 모양).
interface ModelOutput {
	questions: string[];
	twee: string;
	draftUpdate: string;
}

// 모델 출력 + 그 호출이 쓴 토큰. usage는 모델이 만드는 게 아니라 응답 메타에서
// 우리가 붙인다 — 비용 표시와 캐싱 효과 판단에 쓸 유일한 실측값이다.
export interface TranslateResult extends ModelOutput {
	usage: TokenUsage;
}

function buildUser(input: TranslateInput): string {
	let user =
		input.mode === 'scenario'
			? `제목: ${input.weekLabel}\n\n시나리오 구상:\n"""\n${input.draftText}\n"""\n`
			: `주차: ${input.weekLabel}\n\n회고 초안:\n"""\n${input.draftText}\n"""\n`;
	if (input.existingTwee) {
		user += `\n기존 twee(구절 제목과 StoryData 유지):\n"""\n${input.existingTwee}\n"""\n`;
	}
	if (input.feedback) user += `\n보완 요청: ${input.feedback}\n`;
	if (input.qa?.length) {
		user +=
			'\n앞선 질문에 대한 사용자 답변:\n' +
			input.qa.map(([q, a]) => `- Q: ${q}\n  A: ${a}`).join('\n') +
			'\n더 물을 게 없으면 questions는 빈 배열로 둔다.\n';
	}
	return user;
}

async function translateAnthropic(
	input: TranslateInput,
	system: string,
	user: string
): Promise<TranslateResult> {
	const anthropic = new Anthropic({apiKey: input.apiKey});
	const outputConfig: any = {
		format: {type: 'json_schema', schema: OUTPUT_SCHEMA}
	};
	const req: any = {
		model: input.model,
		max_tokens: 16000,
		system,
		messages: [{role: 'user', content: user}]
	};
	if (supportsAdaptive(input.model)) {
		req.thinking = {type: 'adaptive'};
		// effort 기본값은 high(사고 토큰 최대 = 최고 비용). 회고→twee는 형식이 정해진
		// 작업이라 medium이면 충분 — 사고량을 낮춰 비용을 아낀다. (effort는 adaptive
		// 지원 모델에서만 유효; Haiku 등은 미지원이라 생략)
		outputConfig.effort = 'medium';
	}
	req.output_config = outputConfig;

	const response = await anthropic.messages.create(req);
	const text = (response.content as any[])
		.filter(b => b.type === 'text')
		.map(b => b.text)
		.join('');
	if (!text) {
		throw new Error(
			'모델이 빈 응답을 반환했어요(정책 거부 등). 다른 모델을 시도해 주세요.'
		);
	}
	const u = response.usage;
	return {
		...(JSON.parse(text) as ModelOutput),
		usage: {
			inputTokens: u?.input_tokens ?? 0,
			outputTokens: u?.output_tokens ?? 0,
			cacheReadTokens: u?.cache_read_input_tokens ?? 0,
			cacheWriteTokens: u?.cache_creation_input_tokens ?? 0
		}
	};
}

async function translateOpenAI(
	input: TranslateInput,
	system: string,
	user: string
): Promise<TranslateResult> {
	const openai = new OpenAI({apiKey: input.apiKey});
	const response = await openai.chat.completions.create({
		model: input.model,
		messages: [
			{role: 'system', content: system},
			{role: 'user', content: user}
		],
		response_format: {
			type: 'json_schema',
			json_schema: {name: 'twee_output', strict: true, schema: OUTPUT_SCHEMA}
		}
	});
	const text = response.choices[0]?.message?.content ?? '';
	if (!text) {
		throw new Error('모델이 빈 응답을 반환했어요. 다른 모델을 시도해 주세요.');
	}
	// OpenAI의 prompt_tokens는 캐시분을 포함한 총 입력이라, 캐시 항목을 따로 채우면
	// 이중 계산이 된다. 입력에 합쳐 담고 캐시는 0으로 둔다(OpenAI는 단가표에도 없어
	// 비용이 null로 나가므로 표시에는 영향이 없다).
	return {
		...(JSON.parse(text) as ModelOutput),
		usage: {
			...EMPTY_USAGE,
			inputTokens: response.usage?.prompt_tokens ?? 0,
			outputTokens: response.usage?.completion_tokens ?? 0
		}
	};
}

export async function translate(
	input: TranslateInput
): Promise<TranslateResult> {
	const system = readScript(
		input.mode === 'scenario' ? 'scenario-prompt.md' : 'retro-prompt.md'
	);
	const user = buildUser(input);
	return input.provider === 'openai'
		? translateOpenAI(input, system, user)
		: translateAnthropic(input, system, user);
}
