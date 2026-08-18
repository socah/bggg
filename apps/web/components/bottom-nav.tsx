'use client';

import { usePathname, useRouter } from 'next/navigation';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t-[length:var(--border-w)] border-border bg-surface-raised pt-2 md:hidden"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      {TABS.map(({ tab, label }) => (
        <button
          key={tab}
          type="button"
          onClick={() => router.push(spaceHref(groupId, tab))}
          aria-current={tab === activeTab ? 'page' : undefined}
          className={
            tab === activeTab
              ? 'flex min-h-11 min-w-11 flex-col items-center justify-center px-3 font-body text-xs font-semibold text-accent'
              : 'flex min-h-11 min-w-11 flex-col items-center justify-center px-3 font-body text-xs text-text-muted'
          }
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
