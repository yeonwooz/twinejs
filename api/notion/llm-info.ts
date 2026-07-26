import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {resolveLlmKey} from '../_lib/llm';
import {DEFAULT_MODEL, latestOpusId, MODELS, ModelOption} from '../_lib/models';

// 현재 세션에 설정된 LLM 키(봉인 쿠키 우선, 없으면 Notion 페이지)로 프로바이더를
// 판별해, 그 프로바이더가 쓸 수 있는 모델 목록·기본 모델을 돌려준다.
// 키 값 자체는 절대 반환하지 않는다. 키가 없으면 provider: null.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const s = getSession(req);
	if (!s?.token) {
		res.status(401).json({error: 'not connected'});
		return;
	}
	try {
		const key = await resolveLlmKey(s);
		if (!key) {
			res.status(200).json({provider: null, models: [], defaultModel: null});
			return;
		}

		let models: ModelOption[] = MODELS[key.provider];
		let defaultModel: string = DEFAULT_MODEL[key.provider];

		// Anthropic 기본값은 계정의 "최신 Opus"를 추종(고정 별칭이 없어 런타임 발견).
		// 카탈로그에 없는 신버전이면 목록 맨 앞에 넣어 드롭다운에서 선택 가능하게 한다.
		if (key.provider === 'anthropic') {
			const latest = await latestOpusId(key.apiKey);
			if (latest) {
				defaultModel = latest;
				if (!models.some(m => m.id === latest)) {
					models = [{id: latest, label: latest, hint: '최신 Opus'}, ...models];
				}
			}
		}

		res.status(200).json({provider: key.provider, models, defaultModel});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
