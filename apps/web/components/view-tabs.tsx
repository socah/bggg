'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

export function ViewTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <Tabs value={activeTab} onValueChange={(next) => router.push(spaceHref(groupId, next as ViewTab))}>
      <TabsList aria-label="Sections">
        {TABS.map(({ tab, label }) => (
          <TabsTrigger key={tab} value={tab}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
