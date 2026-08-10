// 스토리 안에서 쓴 "그때의 나에게" 메시지를 부모 앱으로 넘기기 위한 브리지.
//
// 재생 iframe은 `sandbox="allow-scripts"`만 걸려 opaque origin이다(이유는
// sandboxed-story-player.tsx 주석 참고). 그래서 스토리 스크립트는 localStorage도,
// 세션 쿠키가 붙는 fetch도 쓸 수 없다 — 입력칸에 쓴 글은 탭을 닫는 순간 사라진다.
// 격리는 그대로 두고, 텍스트 한 줄만 postMessage로 넘길 좁은 통로를 낸다.
//
// 부모는 origin 대신 발신 window가 자기 iframe인지로 검증한다(opaque origin의
// event.origin은 항상 "null"이라 origin 비교로는 아무것도 구분할 수 없다).

export const STORY_MESSAGE_SOURCE = 'twine-story-message';

// iframe 안에서 도는 코드. 부모 앱의 어떤 것에도 접근하지 않고, 오직 postMessage만 한다.
const BRIDGE_SCRIPT = `(function () {
	var SOURCE = ${JSON.stringify(STORY_MESSAGE_SOURCE)};
	var latest = '';
	var watched = null;
	var sent = null;

	// Harlowe (input-box:)는 <textarea>로 렌더된다. 한 줄짜리 <input>은 이름 입력 같은
	// 다른 용도일 확률이 높아 제외한다 — 아무 입력이나 회고 페이지에 붙으면 안 된다.
	document.addEventListener('input', function (event) {
		var el = event.target;

		if (!el || el.tagName !== 'TEXTAREA') {
			return;
		}

		var value = String(el.value == null ? '' : el.value).trim();

		if (value) {
			latest = value;
			watched = el;
		}
	}, true);

	function flush() {
		if (!latest || latest === sent) {
			return;
		}

		sent = latest;

		try {
			parent.postMessage({source: SOURCE, text: latest}, '*');
		} catch (error) {
			// 부모가 없거나(단독 HTML로 열린 경우) 차단된 경우. 스토리 진행은 막지 않는다.
		}
	}

	// 입력칸이 DOM에서 사라진 순간 = 다음 구절로 넘어간 순간 = "전송"을 누른 순간.
	new MutationObserver(function () {
		if (watched && !document.contains(watched)) {
			watched = null;
			flush();
		}
	}).observe(document.documentElement, {childList: true, subtree: true});

	// 전송 링크를 누르지 않고 탭을 닫는 경우의 마지막 보루.
	window.addEventListener('pagehide', flush);
})();`;

/**
 * Adds the bridge script to a published story document, just before the closing
 * body tag. Published output always has one, but tests and hand-rolled formats
 * may not, so fall back to appending.
 */
export function injectMessageBridge(html: string) {
	const script = `<script>${BRIDGE_SCRIPT}</script>`;
	const index = html.lastIndexOf('</body>');

	if (index === -1) {
		return html + script;
	}

	return html.slice(0, index) + script + html.slice(index);
}
