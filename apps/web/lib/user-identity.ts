import type { PublicUserIdentity } from '@/lib/types';

export function groupUsername(user: PublicUserIdentity): string {
  return user.nickname?.trim() || (user.username === 'unknown-member' ? user.displayName : user.username);
}

export function groupDisplayName(user: PublicUserIdentity): string {
  return user.nickname?.trim() || user.displayName || user.username;
}
