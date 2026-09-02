'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

// These are links to three different routes, not tabs over in-page panels —
// the WAI-ARIA tabs pattern presumes a tabpanel per tab, and there is none
// here. So this is a plain <nav> of real <Link>s marked with
// aria-current="page", the same model BottomNav uses. Using real anchors
// also restores middle-click / open-in-new-tab.
export function ViewTabs() {
  const pathname = usePathname();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <nav aria-label="Sections" className="flex gap-4 font-body text-sm font-medium">
      {TABS.filter(({ tab }) => !(groupId && tab === 'profile')).map(({ tab, label }) => (
        <Link
          key={tab}
          href={spaceHref(groupId, tab)}
          aria-current={tab === activeTab ? 'page' : undefined}
          className={
            tab === activeTab
              ? 'flex min-h-11 items-center pb-2 pt-1 font-semibold text-text [border-bottom:var(--tab-indicator)]'
              : 'flex min-h-11 items-center pb-2 pt-1 text-text-muted'
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
