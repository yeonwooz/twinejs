import {IconDatabase} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../../../components/control/icon-button';
import {NotionStorageDialog, useDialogsContext} from '../../../../dialogs';

// 스토리를 노션 어디에 저장할지 언제든 다시 고를 수 있게 하는 버튼.
export const StorageButton: React.FC = () => {
	const {dispatch} = useDialogsContext();

	return (
		<IconButton
			icon={<IconDatabase />}
			label="저장 위치"
			onClick={() =>
				dispatch({type: 'addDialog', component: NotionStorageDialog})
			}
		/>
	);
};
