import type {VercelRequest, VercelResponse} from '@vercel/node';
import {getSession} from '../_lib/session';
import {resolveLlmKey} from '../_lib/llm';
import {DEFAULT_MODEL, MODELS} from '../_lib/models';

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
		res.status(200).json({
			provider: key.provider,
			models: MODELS[key.provider],
			defaultModel: DEFAULT_MODEL[key.provider]
		});
	} catch (error) {
		res.status(502).json({error: (error as Error).message});
	}
}
