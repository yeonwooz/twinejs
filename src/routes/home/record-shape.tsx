// 기록 한 줄이 자기 안에 뭘 품었는지 보여주는 모양.
//
// 글자로 "회고"/"시나리오"라고 적는 대신 형태로 구분한다 — 회고는 평행우주 다발, 시나리오는
// 막과 결말의 갈래, 아직 번역 안 된 초안은 점선. 태그 뱃지가 필요 없어진다.
//
// 홈에는 우주 은유를 쓰지 않는다(회고 하나가 이미 다중우주라 층위가 겹치고, 시나리오는
// 애초에 평행우주가 아니다). 여기서 그리는 건 우주가 아니라 "그 안에 몇 갈래가 있는지"다.
//
// 스크린 리더에는 숨긴다 — 바로 옆 .detail이 같은 내용을 글자로 이미 말하고 있어서
// 읽어 주면 두 번 들린다.
import * as React from 'react';
import {RecordShape} from '../../store/records';
import './record-shape.css';

// 한 줄에 점을 무한정 늘어놓을 수는 없다. 넘으면 뒤에 +N으로 접는다.
const MAX_DOTS = 8;

export interface RecordShapeGlyphProps {
	shape?: RecordShape;
}

export const RecordShapeGlyph: React.FC<RecordShapeGlyphProps> = ({shape}) => {
	if (!shape) {
		return (
			<span aria-hidden className="record-shape draft">
				<span className="dashes" />
			</span>
		);
	}

	switch (shape.type) {
		case 'universes': {
			const shown = Math.min(shape.count, MAX_DOTS);

			return (
				<span className="record-shape universes" aria-hidden>
					{Array.from({length: shown}, (_, index) => (
						<span className="dot" key={index} />
					))}
					{shape.count > shown && (
						<span className="overflow">+{shape.count - shown}</span>
					)}
				</span>
			);
		}

		case 'acts':
			return (
				<span className="record-shape acts" aria-hidden>
					{Array.from({length: Math.min(shape.acts, MAX_DOTS)}, (_, index) => (
						<span className="act" key={index} />
					))}
					<span className="fan">
						{Array.from(
							{length: Math.min(shape.endings, MAX_DOTS)},
							(_, index) => (
								<span className="ending" key={index} />
							)
						)}
					</span>
				</span>
			);

		// 태그가 없는 예전 스토리는 구조를 모른다. 아무 뜻 없는 막대를 긋느니 비워 둔다 —
		// 옆의 "구절 N개"가 아는 만큼은 이미 말하고 있다.
		case 'passages':
			return null;
	}
};
