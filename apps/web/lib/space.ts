export type ViewTab = 'calendar' | 'collection' | 'profile' | 'chat';

const TABS: ViewTab[] = ['calendar', 'collection', 'profile', 'chat'];

export interface SpacePath {
  groupId: string | null;
  userId: string | null;
  tab: ViewTab | null;
}

// The shell has two parallel "spaces" (user-level and group-level) that
// share the same three tabs — see the design spec's "Two spaces, one set
// of views". Both the group switcher and the view tabs need to parse the
// current URL into (space, tab) so switching one preserves the other.
export function parseSpacePath(pathname: string): SpacePath {
  const groupMatch = pathname.match(/^\/groups\/([^/]+)\/([^/]+)(?:\/([^/]+))?/);
  if (groupMatch) {
    const [, groupId, maybeTab, encodedUserId] = groupMatch;
    const tab = (TABS as string[]).includes(maybeTab) ? (maybeTab as ViewTab) : null;
    const userId = encodedUserId && (tab === 'collection' || tab === 'profile')
      ? decodeURIComponent(encodedUserId)
      : null;
    return { groupId, userId, tab };
  }

  const userMatch = pathname.match(/^\/([^/]+)/);
  const tab = userMatch && (TABS as string[]).includes(userMatch[1]) ? (userMatch[1] as ViewTab) : null;
  return { groupId: null, userId: null, tab };
}

export function spaceHref(groupId: string | null, tab: ViewTab, userId?: string | null): string {
  const base = groupId ? `/groups/${groupId}/${tab}` : `/${tab}`;
  return groupId && userId && tab !== 'calendar' ? `${base}/${encodeURIComponent(userId)}` : base;
}
