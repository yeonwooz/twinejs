// LLM 프로바이더/모델 카탈로그 (서버 단일 소스). translate.ts와 llm-info.ts가
// 같은 목록을 쓰도록 여기 모아둔다. 비용은 사용자가 모델을 고를 때 참고용 힌트로만.
export type Provider = 'anthropic' | 'openai';

export interface ModelOption {
	id: string;
	label: string;
	hint: string;
}

// 저렴 → 비쌈 순. 모두 구조화 출력(json schema)을 지원하는 모델만 넣는다.
export const MODELS: Record<Provider, ModelOption[]> = {
	anthropic: [
		{id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: '가장 저렴·빠름 · $1/$5'},
		{id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: '균형 · $3/$15'},
		{id: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: '고품질(기본) · $5/$25'},
		{id: 'claude-fable-5', label: 'Claude Fable 5', hint: '최고 성능 · $10/$50'}
	],
	openai: [
		{id: 'gpt-4o-mini', label: 'GPT-4o mini', hint: '가장 저렴·빠름'},
		{id: 'gpt-5-mini', label: 'GPT-5 mini', hint: '저렴'},
		{id: 'gpt-4o', label: 'GPT-4o', hint: '균형'},
		{id: 'gpt-5', label: 'GPT-5', hint: '고품질'}
	]
};

export const DEFAULT_MODEL: Record<Provider, string> = {
	anthropic: 'claude-opus-4-8',
	openai: 'gpt-5'
};

// 키 접두사로 프로바이더 판별. Anthropic 키는 sk-ant- 로 시작하고, 그 외 sk- 는 OpenAI.
export function providerFromKey(apiKey: string): Provider {
	return apiKey.startsWith('sk-ant-') ? 'anthropic' : 'openai';
}

// 요청받은 모델이 그 프로바이더 목록에 없으면 기본값으로 되돌린다
// (예: Anthropic 키인데 OpenAI 모델을 골랐을 때 방어).
export function resolveModel(provider: Provider, model?: string): string {
	if (model && MODELS[provider].some(m => m.id === model)) return model;
	return DEFAULT_MODEL[provider];
}
