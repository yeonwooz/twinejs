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

export function validateTwee(twee: string): string[] {
	const titles = new Set(
		[...twee.matchAll(/^:: (.+)$/gm)].map(m =>
			m[1].trim().replace(/\s*\[stylesheet\]$/, '')
		)
	);
	const links = [...twee.matchAll(/\[\[[^\]]*?->([^\]]+)\]\]/g)].map(m =>
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
	const problems: string[] = [];
	if (missing.length) problems.push(`끊긴 링크: ${[...new Set(missing)].join(', ')}`);
	if (!start || !titles.has(start)) problems.push(`StoryData.start "${start}" 구절 없음`);
	return problems;
}

// StoryData.start가 없거나 실제 구절을 안 가리키면 첫 서사 구절로 코드에서 지정한다.
// 이게 자동보정 재시도(LLM 1회 추가 호출)를 흔히 유발하는 문제라, 코드로 먼저 때워
// 비용을 아낀다. StoryData 블록 자체가 없거나 서사 구절이 없으면 손대지 않고 그대로 둔다.
export function repairStartPassage(twee: string): string {
	const sd = twee.match(/(:: StoryData\n)(\{[\s\S]*?\})/);
	if (!sd) return twee;

	const headings = [...twee.matchAll(/^:: (.+)$/gm)].map(m => m[1].trim());
	const narrative = headings.filter(
		h => h !== 'StoryTitle' && h !== 'StoryData' && !/\[stylesheet\]$/.test(h)
	);
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

export function withCosmicUI(twee: string): string {
	const css = readScript('cosmic-stylesheet.txt').trimEnd();
	const stripped = twee.replace(
		/\n:: [^\n]*\[stylesheet\][\s\S]*?(?=\n:: |\s*$)/g,
		''
	);
	return stripped.trimEnd() + '\n\n' + css + '\n';
}

export interface TranslateInput {
	apiKey: string;
	provider: Provider;
	model: string;
	draftText: string;
	weekLabel: string;
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
	let user = `주차: ${input.weekLabel}\n\n회고 초안:\n"""\n${input.draftText}\n"""\n`;
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
		throw new Error('모델이 빈 응답을 반환했어요(정책 거부 등). 다른 모델을 시도해 주세요.');
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

export async function translate(input: TranslateInput): Promise<TranslateResult> {
	const system = readScript('retro-prompt.md');
	const user = buildUser(input);
	return input.provider === 'openai'
		? translateOpenAI(input, system, user)
		: translateAnthropic(input, system, user);
}
