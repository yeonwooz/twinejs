import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {ErrorMessage} from '../error';
import {
	injectMessageBridge,
	STORY_MESSAGE_SOURCE
} from './story-message-bridge';
import './sandboxed-story-player.css';

export interface SandboxedStoryPlayerProps {
	// Returns a self-contained published story HTML document (see publish.ts).
	publish: () => Promise<string>;

	// 스토리 안의 <textarea> 입력칸(Harlowe `(input-box:)`)에 쓴 글을, 구절이 넘어가는
	// 순간 받는다. 넘기면 브리지 스크립트가 주입된다 — story-message-bridge.ts 참고.
	onStoryMessage?: (text: string) => void;

	// 재생 화면 위에 띄울 짧은 안내(메시지 저장 진행/성공/실패 등).
	notice?: string;
}

// Renders a published story inside a sandboxed iframe. `allow-scripts` lets the
// story's own JavaScript run, but the deliberate absence of `allow-same-origin`
// gives the iframe an opaque origin: story scripts cannot read the parent app's
// cookies, sessionStorage, or DOM. This matters on the hosted (Vercel) build,
// where a Notion session cookie lives on the app origin — a malicious `[script]`
// passage must not be able to reach it.
//
// Tradeoff: the story format's own web storage (e.g. Harlowe game saves) also
// can't persist under an opaque origin. That's an accepted cost of isolation.
// `onStoryMessage` opens one narrow, one-way channel back out of that box.
export const SandboxedStoryPlayer: React.FC<SandboxedStoryPlayerProps> = ({
	publish,
	onStoryMessage,
	notice
}) => {
	const history = useHistory();
	const [html, setHtml] = React.useState<string>();
	const [error, setError] = React.useState<Error>();
	const [inited, setInited] = React.useState(false);
	const iframeRef = React.useRef<HTMLIFrameElement>(null);

	// 핸들러를 ref로 들고 있어야 리스너를 다시 붙이지 않고도 최신 것을 부른다.
	const handlerRef = React.useRef(onStoryMessage);

	React.useEffect(() => {
		handlerRef.current = onStoryMessage;
	}, [onStoryMessage]);

	// 브리지 주입 여부는 최초 게시 시점에 결정된다(주입된 HTML은 다시 만들지 않는다).
	const bridgedRef = React.useRef(!!onStoryMessage);

	React.useEffect(() => {
		if (inited) {
			return;
		}

		setInited(true);
		publish()
			.then(published =>
				setHtml(bridgedRef.current ? injectMessageBridge(published) : published)
			)
			.catch(caught => setError(caught as Error));
	}, [inited, publish]);

	React.useEffect(() => {
		function receive(event: MessageEvent) {
			// opaque origin이라 event.origin은 항상 "null" — origin으로는 아무것도
			// 구분할 수 없으니, 발신 window가 우리 iframe인지로 검증한다.
			if (
				!iframeRef.current ||
				event.source !== iframeRef.current.contentWindow
			) {
				return;
			}

			const data = event.data;

			if (!data || data.source !== STORY_MESSAGE_SOURCE) {
				return;
			}

			const text = typeof data.text === 'string' ? data.text.trim() : '';

			if (text) {
				handlerRef.current?.(text);
			}
		}

		window.addEventListener('message', receive);
		return () => window.removeEventListener('message', receive);
	}, []);

	if (error) {
		return <ErrorMessage>{error.message}</ErrorMessage>;
	}

	if (html === undefined) {
		return null;
	}

	return (
		<>
			<button
				className="sandboxed-story-back"
				onClick={() => history.push('/')}
			>
				← 목록으로
			</button>
			{notice && <div className="sandboxed-story-notice">{notice}</div>}
			<iframe
				className="sandboxed-story-player"
				ref={iframeRef}
				title="Story"
				sandbox="allow-scripts"
				srcDoc={html}
			/>
		</>
	);
};
