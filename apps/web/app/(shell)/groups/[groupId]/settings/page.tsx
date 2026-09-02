import { auth } from '@/auth';
import { GroupSettings } from '@/components/group-settings';

export default async function GroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const session = await auth();

  return <GroupSettings groupId={groupId} currentUserId={session?.user?.id ?? ''} />;
}
