import { MemberProfile } from '@/components/member-profile';

export default async function MemberProfilePage({ params }: { params: Promise<{ groupId: string; userId: string }> }) {
  const { groupId, userId } = await params;
  return <MemberProfile groupId={groupId} userId={userId} />;
}
