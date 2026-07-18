import {IconStars} from '@tabler/icons';
import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {IconButton} from '../../../../components/control/icon-button';

// Notion 회고를 인터랙티브 스토리로 만드는 위저드로 이동.
export const RetroButton: React.FC = () => {
	const history = useHistory();
	return (
		<IconButton
			icon={<IconStars />}
			label="회고"
			onClick={() => history.push('/retro')}
		/>
	);
};
