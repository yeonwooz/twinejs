// LLM 프로바이더/모델 카탈로그 (서버 단일 소스). translate.ts와 llm-info.ts가
// 같은 목록을 쓰도록 여기 모아둔다. 비용은 사용자가 모델을 고를 때 참고용 힌트로만.
import Anthropic from '@anthropic-ai/sdk';

export type Provider = 'anthropic' | 'openai';

export interface ModelOption {
	id: string;
	label: string;
	hint: string;
}

// 1M 토큰당 USD(공식 목록가). 모델 선택 힌트와 사용량 비용 계산이 같은 값을 쓰도록
// 여기 한 곳에 둔다 — 단가가 바뀌면 이 표만 고친다.
//
// OpenAI 단가는 일부러 넣지 않는다. 확인된 출처 없이 적어두면 틀린 값이 사용자에게
// 비용으로 표시되기 때문 — 표에 없는 모델은 비용이 null로 나가고 토큰 수만 보인다.
export interface ModelPrice {
	input: number;
	output: number;
}

export const PRICES: Record<string, ModelPrice> = {
	'claude-haiku-4-5': {input: 1, output: 5},
	'claude-sonnet-4-6': {input: 3, output: 15},
	'claude-sonnet-5': {input: 3, output: 15},
	'claude-opus-4-6': {input: 5, output: 25},
	'claude-opus-4-7': {input: 5, output: 25},
	'claude-opus-4-8': {input: 5, output: 25},
	'claude-opus-5': {input: 5, output: 25},
	'claude-fable-5': {input: 10, output: 50}
};

function option(id: string, label: string, note: string): ModelOption {
	const p = PRICES[id];
	return {id, label, hint: p ? `${note} · $${p.input}/$${p.output}` : note};
}

// 저렴 → 비쌈 순. 모두 구조화 출력(json schema)을 지원하는 모델만 넣는다.
export const MODELS: Record<Provider, ModelOption[]> = {
	anthropic: [
		option('claude-haiku-4-5', 'Claude Haiku 4.5', '가장 저렴·빠름'),
		option('claude-sonnet-5', 'Claude Sonnet 5', '균형'),
		option('claude-opus-4-8', 'Claude Opus 4.8', '고품질(기본)'),
		option('claude-fable-5', 'Claude Fable 5', '최고 성능')
	],
	openai: [
		option('gpt-4o-mini', 'GPT-4o mini', '가장 저렴·빠름'),
		option('gpt-5-mini', 'GPT-5 mini', '저렴'),
		option('gpt-4o', 'GPT-4o', '균형'),
		option('gpt-5', 'GPT-5', '고품질')
	]
};

// --- 사용량·비용 -----------------------------------------------------------

// 번역 요청이 쓴 토큰. Anthropic의 input_tokens는 캐시분을 제외한 나머지이므로
// (총 입력 = input + cache_read + cache_write) 네 값을 겹치지 않게 더할 수 있다.
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0
};

// 한 회고는 번역을 여러 번 호출한다(질문 라운드·검증 보정·보완 재번역). 합산용.
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
		cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens
	};
}

// 단가를 모르는 모델(OpenAI 등)은 null. 캐시 읽기는 입력 단가의 0.1배, 쓰기는
// 1.25배(기본 5분 TTL) — 지금은 캐싱을 켜지 않아 두 값이 0이지만, 켰을 때도
// 계산이 맞도록 넣어둔다.
export function costUsd(model: string, u: TokenUsage): number | null {
	const p = PRICES[model];
	if (!p) return null;
	const perMillion = 1_000_000;
	return (
		(u.inputTokens * p.input +
			u.cacheWriteTokens * p.input * 1.25 +
			u.cacheReadTokens * p.input * 0.1 +
			u.outputTokens * p.output) /
		perMillion
	);
}

export const DEFAULT_MODEL: Record<Provider, string> = {
	anthropic: 'claude-opus-4-8',
	openai: 'gpt-5'
};

// 키 접두사로 프로바이더 판별. Anthropic 키는 sk-ant- 로 시작하고, 그 외 sk- 는 OpenAI.
export function providerFromKey(apiKey: string): Provider {
	return apiKey.startsWith('sk-ant-') ? 'anthropic' : 'openai';
}

// 요청받은 모델이 그 프로바이더 목록에 없으면 기본값으로 되돌린다
// (예: Anthropic 키인데 OpenAI 모델을 골랐을 때 방어). 단, Anthropic Opus는
// 카탈로그에 없는 최신 버전(런타임 발견분)도 허용한다.
export function resolveModel(provider: Provider, model?: string): string {
	if (
		model &&
		(MODELS[provider].some(m => m.id === model) ||
			(provider === 'anthropic' && /^claude-opus-/.test(model)))
	) {
		return model;
	}
	return DEFAULT_MODEL[provider];
}

// 계정에서 접근 가능한 가장 최근 Opus 모델 ID를 Models API로 찾는다. "opus-latest"
// 같은 고정 별칭이 없어서, 기본값을 특정 버전에 못박지 않고 최신을 추종하려는 목적.
// 실패하면 null → 호출부가 DEFAULT_MODEL로 폴백.
export async function latestOpusId(apiKey: string): Promise<string | null> {
	try {
		const anthropic = new Anthropic({apiKey});
		const list = await anthropic.models.list({limit: 100});
		const opus = list.data
			.filter(m => m.id.startsWith('claude-opus-'))
			.sort((a, b) =>
				String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
			);
		return opus[0]?.id ?? null;
	} catch {
		return null;
	}
}
