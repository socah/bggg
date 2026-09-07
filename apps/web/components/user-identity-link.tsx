import Link from 'next/link';
import type { PublicUserIdentity } from '@/lib/types';

export function UserIdentityLink({
  user,
  groupId,
  className = '',
}: {
  user: PublicUserIdentity;
  groupId: string | null | undefined;
  className?: string;
}) {
  const label = `@${user.username}`;
  if (!groupId || user.username === 'unknown-member') {
    return <span className={className} title={user.displayName}>{label}</span>;
  }
  return <Link href={`/groups/${groupId}/profile/${encodeURIComponent(user.id)}`} className={`underline decoration-transparent underline-offset-2 hover:decoration-current ${className}`} title={user.displayName}>{label}</Link>;
}
