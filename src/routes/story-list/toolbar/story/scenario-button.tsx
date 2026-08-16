import {IconMasksTheater} from '@tabler/icons';
import * as React from 'react';
import {useHistory} from 'react-router-dom';
import {IconButton} from '../../../../components/control/icon-button';

// 이야기 구상을 인터랙티브 창작 시나리오로 만드는 위저드로 이동.
export const ScenarioButton: React.FC = () => {
	const history = useHistory();
	return (
		<IconButton
			icon={<IconMasksTheater />}
			label="시나리오"
			onClick={() => history.push('/scenario')}
		/>
	);
};
