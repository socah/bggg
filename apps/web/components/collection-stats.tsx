'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatDateDmy } from '@/lib/datetime';
import type { CollectionStats } from '@/lib/collection-stats-types';

const euros = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function GrowthChart({ growth }: { growth: CollectionStats['growth'] }) {
  if (!growth.length) return null;
  const time = (month: string) => new Date(`${month}-01T00:00:00Z`).getTime();
  const first = time(growth[0].month);
  const last = time(growth[growth.length - 1].month);
  const max = Math.max(...growth.map((point) => point.collectionSize), 1);
  const x = (month: string) => 45 + (time(month) - first) / (last - first || 1) * 600;
  const y = (count: number) => 170 - count / max * 140;
  return <svg viewBox="0 0 690 210" role="img" aria-label="Collection growth over time: cumulative games currently owned" className="mt-4 w-full">
    {[0, max].map((count) => <g key={count}><line x1="45" x2="645" y1={y(count)} y2={y(count)} stroke="var(--border)" /><text x="38" y={y(count) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="12">{count}</text></g>)}
    <polyline points={growth.map((point) => `${x(point.month)},${y(point.collectionSize)}`).join(' ')} fill="none" stroke="var(--accent-2)" strokeWidth="3" />
    {growth.map((point) => <circle key={point.month} cx={x(point.month)} cy={y(point.collectionSize)} r="4" fill="var(--accent-2)"><title>{monthLabel(point.month)} · {point.collectionSize} games · {point.acquired} acquired</title></circle>)}
    <text x="45" y="198" fill="var(--text-muted)" fontSize="12">{monthLabel(growth[0].month)}</text>
    {last !== first && <text x="645" y="198" textAnchor="end" fill="var(--text-muted)" fontSize="12">{monthLabel(growth[growth.length - 1].month)}</text>}
  </svg>;
}

export function PersonalCollectionStats() {
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let requestId = 0;
    async function load() {
      const id = ++requestId;
      try {
        const response = await apiFetch('/bgg-account/collection-stats', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load collection stats');
        const next = await response.json() as CollectionStats;
        if (active && id === requestId) { setStats(next); setError(false); }
      } catch {
        if (active && id === requestId) setError(true);
      }
    }
    void load();
    function changed() { void load(); }
    window.addEventListener('collection-stats-changed', changed);
    window.addEventListener('focus', changed);
    return () => {
      active = false;
      window.removeEventListener('collection-stats-changed', changed);
      window.removeEventListener('focus', changed);
    };
  }, [refresh]);

  return <section aria-labelledby="collection-stats-heading" className="max-w-5xl rounded-md border border-border bg-surface-raised p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-mono text-xs uppercase tracking-widest text-text-muted">Your private collection</p><h2 id="collection-stats-heading" className="mt-1 font-display text-2xl">Collection statistics</h2></div>
      <button type="button" onClick={() => setRefresh((value) => value + 1)} className="text-sm font-semibold text-accent underline">Refresh collection stats</button>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-accent">Could not load collection stats. Try refreshing.</p>}
    {!stats && !error && <p role="status" className="mt-4 text-sm text-text-muted">Loading collection stats...</p>}
    {stats && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-border bg-surface p-3"><h3 className="text-xs font-semibold text-text-muted">Games owned</h3><strong className="mt-1 block font-display text-3xl text-accent-2">{stats.gameCount}</strong></div>
        <div className="rounded-sm border border-border bg-surface p-3"><h3 className="text-xs font-semibold text-text-muted">Recorded acquisition value</h3><strong className="mt-1 block font-display text-3xl">{euros(stats.acquisitionValue)}</strong><p className="mt-1 text-xs text-text-muted">Purchase prices recorded for {stats.acquisitionPriceCount} of {stats.gameCount} games</p></div>
        <div className="rounded-sm border border-border bg-surface p-3"><h3 className="text-xs font-semibold text-text-muted">Estimated market value</h3><strong className="mt-1 block font-display text-3xl">{stats.estimatedMarketValue === null ? 'Not available' : euros(stats.estimatedMarketValue)}</strong><p className="mt-1 text-xs text-text-muted">Prices available for {stats.marketPriceCount} of {stats.gameCount} games{stats.acquisitionFallbackCount > 0 && ` · ${stats.acquisitionFallbackCount} use acquisition value`}{stats.stalePriceCount > 0 && ` · ${stats.stalePriceCount} use last known prices`}</p></div>
      </div>
      <p className="mt-3 text-xs text-text-muted">EUR · owned games only. Games without a recorded purchase price are excluded from acquisition totals. Games without any market, retail or acquisition value are excluded from estimated totals. Prices are tracked in the background; refresh to see newly collected prices.</p>
      <p className="mt-2 text-xs text-text-muted">Market estimate uses the cheapest eligible second-hand listing. If that exceeds the cheapest available retail price, or no eligible second-hand listing exists, we use retail minus 25%. If neither price is available, we use your recorded acquisition value. Retail includes known delivery to Greece; marketplace shipping is extra. Asking prices are estimates, not completed sales.</p>
      <h3 className="mt-6 font-display text-xl">Collection growth over time</h3>
      <p className="mt-1 text-xs text-text-muted">Acquisitions of games currently owned, grouped by month. Uses Date acquired; {stats.fallbackDateCount} games use the date added to the collection instead. Removed games are not included.</p>
      {stats.gameCount === 0 && <p className="mt-4 text-sm text-text-muted">Add games to your collection to start tracking growth and value.</p>}
      <GrowthChart growth={stats.growth} />
      {stats.growth.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Monthly growth details</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Monthly acquisitions and cumulative recorded purchase value</caption><thead><tr><th className="p-2">Month</th><th className="p-2">Acquired</th><th className="p-2">Games in collection</th><th className="p-2">Recorded value</th></tr></thead><tbody>{stats.growth.map((point) => <tr key={point.month} className="border-t border-border"><td className="p-2">{monthLabel(point.month)}</td><td className="p-2">{point.acquired}</td><td className="p-2">{point.collectionSize}</td><td className="p-2">{euros(point.recordedSpend)}</td></tr>)}</tbody></table></div></details>}
      {stats.games.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Per-game valuation details</summary><div className="mt-2 max-h-96 overflow-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Private collection acquisition prices and estimated values by game</caption><thead><tr><th className="p-2">Game</th><th className="p-2">Acquired / added</th><th className="p-2">Amount paid</th><th className="p-2">Estimated value</th><th className="p-2">Basis</th></tr></thead><tbody>{stats.games.map((game) => <tr key={game.gameId} className="border-t border-border"><td className="p-2 font-semibold">{game.name}</td><td className="p-2">{formatDateDmy(game.dateAcquired ?? game.addedAt)}{game.dateAcquired === null && ' (added)'}</td><td className="p-2">{game.amountPaid === null ? 'Not recorded' : euros(game.amountPaid)}</td><td className="p-2">{game.estimatedValue === null ? 'Unavailable' : euros(game.estimatedValue)}</td><td className="p-2">{game.basis === 'second-hand' ? 'Second-hand minimum' : game.basis === 'retail-minus-25-percent' ? 'Retail − 25%' : game.basis === 'acquisition' ? 'Acquisition value' : 'No price data'}{game.stale && game.estimatedValue !== null && ' · last known'}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>;
}
