import { GroupHostingStats } from '@/components/hosting-stats';

export default async function GroupProfilePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <GroupHostingStats groupId={groupId} />;
}
