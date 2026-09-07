import { MemberHostingStats } from '@/components/hosting-stats';

export function MemberProfile({ groupId, userId }: { groupId: string; userId: string }) {
  return <MemberHostingStats groupId={groupId} userId={userId} />;
}
