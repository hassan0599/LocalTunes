import { useLocalSearchParams } from 'expo-router';

import { FolderList } from '@/components/FolderList';
import { StackScreen } from '@/components/StackScreen';
import { folderTitle } from '@/services/media/folders';

/** A folder below Library → Folders. */
export default function FolderScreen() {
  const { path = '' } = useLocalSearchParams<{ path: string }>();
  return (
    <StackScreen title={folderTitle(path)}>
      <FolderList path={path} />
    </StackScreen>
  );
}
