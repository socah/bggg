'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

interface ImportSummary {
  total: number;
  wishlist: { total: number };
}

export function CollectionSyncButton() {
  const pathname = usePathname();
  const [linked, setLinked] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (pathname !== '/collection') return;
    let cancelled = false;
    void apiFetch('/bgg-account')
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { account: object | null };
        if (!cancelled) setLinked(Boolean(result.account));
      })
      .catch(() => {
        if (!cancelled) setLinked(false);
      });
    return () => { cancelled = true; };
  }, [pathname]);

  if (pathname !== '/collection' || !linked) return null;

  async function sync() {
    setSyncing(true);
    try {
      const response = await apiFetch('/bgg-account/import', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to import from BGG');
      const summary = await response.json() as ImportSummary;
      window.dispatchEvent(new CustomEvent('bgg-collection-synced', {
        detail: `Synced ${summary.total} owned and ${summary.wishlist.total} wishlist games and ratings from BGG.`,
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('bgg-collection-sync-failed', {
        detail: error instanceof Error ? error.message : 'Unable to import from BGG',
      }));
    } finally {
      setSyncing(false);
    }
  }

  return <Button type="button" onClick={() => void sync()} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync BGG'}</Button>;
}
