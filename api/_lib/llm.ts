import {Provider} from './models';
import {readLlmKey} from './notion';
import {Session} from './session';

// LLM 키 해석: 세션(봉인 쿠키)에 저장된 키가 있으면 그걸 쓰고, 없으면 예전 방식대로
// Notion 루트 페이지 본문에서 읽는다(하위호환). 어느 쪽도 없으면 undefined.
export async function resolveLlmKey(
	s: Session
): Promise<{apiKey: string; provider: Provider} | undefined> {
	if (s.llmKey && s.llmProvider) {
		return {apiKey: s.llmKey, provider: s.llmProvider};
	}
	if (s.rootId) {
		return readLlmKey(s.token, s.rootId);
	}
	return undefined;
}
