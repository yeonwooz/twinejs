import {Provider} from './models';
import {Session} from './session';

// LLM 키 해석: 봉인 세션 쿠키에 담긴 키만 쓴다.
//
// 예전엔 쿠키에 키가 없으면 Notion 루트 페이지 본문을 정규식으로 긁어
// `ANTHROPIC_API_KEY: sk-ant-...` 를 읽는 폴백이 있었다. 제거했다 —
// Notion 페이지는 영구히 남고, 워크스페이스 멤버 전원이 읽을 수 있고,
// 공유·검색되는 저장소라 API 키를 평문으로 둘 곳이 아니다.
// 쿠키에 키가 없으면 사용자가 앱에서 다시 입력하면 된다.
export function resolveLlmKey(
	s: Session
): {apiKey: string; provider: Provider} | undefined {
	if (s.llmKey && s.llmProvider) {
		return {apiKey: s.llmKey, provider: s.llmProvider};
	}
	return undefined;
}
