'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

export function ViewTabs() {
  const pathname = usePathname();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <nav className="flex gap-3 text-sm font-medium">
      {TABS.map(({ tab, label }) => (
        <Link
          key={tab}
          href={spaceHref(groupId, tab)}
          className={tab === activeTab ? 'text-blue-600 underline' : 'text-gray-600'}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
