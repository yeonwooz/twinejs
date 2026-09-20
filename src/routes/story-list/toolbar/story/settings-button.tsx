import {IconSettings} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../../../components/control/icon-button';
import {SettingsDialog, useDialogsContext} from '../../../../dialogs';

// /stories(예전 홈)에서 설정을 여는 버튼. 홈에는 헤더에 상시 표시등 겸 버튼이 있고,
// 여기는 편집기 쪽에서 들어온 사람을 위한 같은 문 하나다.
export const SettingsButton: React.FC = () => {
	const {dispatch} = useDialogsContext();

	return (
		<IconButton
			icon={<IconSettings />}
			label="설정"
			onClick={() => dispatch({type: 'addDialog', component: SettingsDialog})}
		/>
	);
};
