export type ViewTab = 'calendar' | 'collection' | 'profile';

const TABS: ViewTab[] = ['calendar', 'collection', 'profile'];

export interface SpacePath {
  groupId: string | null;
  tab: ViewTab;
}

// The shell has two parallel "spaces" (user-level and group-level) that
// share the same three tabs — see the design spec's "Two spaces, one set
// of views". Both the group switcher and the view tabs need to parse the
// current URL into (space, tab) so switching one preserves the other.
export function parseSpacePath(pathname: string): SpacePath {
  const groupMatch = pathname.match(/^\/groups\/([^/]+)\/([^/]+)/);
  if (groupMatch) {
    const [, groupId, maybeTab] = groupMatch;
    const tab = (TABS as string[]).includes(maybeTab) ? (maybeTab as ViewTab) : 'calendar';
    return { groupId, tab };
  }

  const userMatch = pathname.match(/^\/([^/]+)/);
  const tab =
    userMatch && (TABS as string[]).includes(userMatch[1]) ? (userMatch[1] as ViewTab) : 'calendar';
  return { groupId: null, tab };
}

export function spaceHref(groupId: string | null, tab: ViewTab): string {
  return groupId ? `/groups/${groupId}/${tab}` : `/${tab}`;
}
