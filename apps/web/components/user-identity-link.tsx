import Link from 'next/link';
import type { PublicUserIdentity } from '@/lib/types';
import { groupUsername } from '@/lib/user-identity';

export function UserIdentityLink({
  user,
  groupId,
  className = '',
}: {
  user: PublicUserIdentity;
  groupId: string | null | undefined;
  className?: string;
}) {
  const label = groupUsername(user);
  if (!groupId || user.username === 'unknown-member') {
    return <span className={className} title={user.displayName}>{label}</span>;
  }
  return <Link href={`/groups/${groupId}/collection/${encodeURIComponent(user.id)}`} className={`underline decoration-transparent underline-offset-2 hover:decoration-current ${className}`} title={user.displayName}>{label}</Link>;
}
