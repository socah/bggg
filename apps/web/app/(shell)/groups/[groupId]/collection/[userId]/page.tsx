import { MemberCollection } from '@/components/member-collection';

export default async function MemberCollectionPage({ params }: { params: Promise<{ groupId: string; userId: string }> }) {
  const { groupId, userId } = await params;
  return <MemberCollection groupId={groupId} userId={userId} />;
}
