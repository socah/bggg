'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatDateDmy } from '@/lib/datetime';
import type { PriceOverview, PricePoint, PriceSource } from '@/lib/price-types';

const euros = (price: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(price);

function OfferCard({ title, source, shipping }: { title: string; source: PriceSource; shipping: string }) {
  const offer = source.cheapest;
  return <div className="rounded-sm border border-border bg-surface-raised p-3">
    <h4 className="text-xs font-semibold text-text-muted">{title}</h4>
    {offer ? <>
      <a href={offer.url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-display text-2xl text-accent underline underline-offset-4">{euros(offer.price)}</a>
      <p className="mt-1 text-xs">{offer.label}{offer.language && ` · ${offer.language}`}{offer.country && ` · ${offer.country}`}</p>
      {offer.product !== undefined && <p className="mt-1 text-xs text-text-muted">Game {euros(offer.product)} · shipping {euros(offer.shipping ?? 0)}</p>}
    </> : <p className="mt-2 text-sm text-text-muted">{source.error ? 'Unavailable' : 'No eligible listings'}</p>}
    <p className="mt-1 text-xs text-text-muted">{shipping}</p>
    {source.stale && offer && <p className="mt-1 text-xs text-accent">Last known price · may have changed</p>}
    {source.error && <p role="status" className="mt-1 text-xs text-accent">{source.error}</p>}
    {source.fetchedAt && <p className="mt-1 text-xs text-text-muted">Checked {formatDateDmy(source.fetchedAt)} {new Date(source.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
  </div>;
}

function PriceChart({ data }: { data: PriceOverview }) {
  const series = [
    { name: 'Retail delivered to Greece', color: 'var(--accent)', points: data.retail.history.map((point) => ({ ...point, value: point.price })) },
    { name: 'GeekMarket EUR (filtered, no shipping)', color: 'var(--accent-2)', points: data.market.history.map((point) => ({ ...point, value: point.filteredPrice })) },
  ];
  const samples = series.flatMap((entry) => entry.points.filter((point) => point.value !== null).map((point) => ({ date: point.date, price: point.value! })));
  if (!samples.length) return <p className="py-4 text-sm text-text-muted">Price history will appear after the first successful price check.</p>;
  const all = [...samples, ...data.bargain.trend];
  const times = all.map((point) => new Date(point.date).getTime());
  const first = Math.min(...times);
  const last = Math.max(...times);
  const max = Math.max(...all.map((point) => point.price)) * 1.15;
  const x = (date: string) => 65 + (new Date(date).getTime() - first) / (last - first || 1) * 600;
  const y = (price: number) => 170 - price / max * 145;
  return <>
    <svg viewBox="0 0 700 210" role="img" aria-label="Price history in euros: retail, filtered GeekMarket, and bargain trend" className="mt-3 w-full">
      {[0, 0.5, 1].map((fraction) => <g key={fraction}>
        <line x1="65" x2="665" y1={y(max * fraction)} y2={y(max * fraction)} stroke="var(--border)" />
        <text x="58" y={y(max * fraction) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="11">{euros(max * fraction)}</text>
      </g>)}
      {series.map((entry) => <g key={entry.name}>
        {/* Segment at missing observations rather than connecting sold-out days. */}
        {entry.points.map((point, index) => {
          const previous = entry.points[index - 1];
          if (point.value === null) return null;
          return <g key={point.date}>
            {previous?.value != null && new Date(point.date).getTime() - new Date(previous.date).getTime() <= 86_400_000 && <line x1={x(previous.date)} y1={y(previous.value)} x2={x(point.date)} y2={y(point.value)} stroke={entry.color} strokeWidth="2" />}
            <circle cx={x(point.date)} cy={y(point.value)} r="3" fill={entry.color}><title>{entry.name} · {formatDateDmy(point.date)} · {euros(point.value)}</title></circle>
          </g>;
        })}
      </g>)}
      {data.bargain.trend.length === 2 && <line x1={x(data.bargain.trend[0].date)} y1={y(data.bargain.trend[0].price)} x2={x(data.bargain.trend[1].date)} y2={y(data.bargain.trend[1].price)} stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="6 4" />}
      <text x="65" y="198" fill="var(--text-muted)" fontSize="11">{formatDateDmy(new Date(first).toISOString())}</text>
      {last !== first && <text x="665" y="198" textAnchor="end" fill="var(--text-muted)" fontSize="11">{formatDateDmy(new Date(last).toISOString())}</text>}
    </svg>
    <div className="flex flex-wrap gap-3 text-xs text-text-muted">{series.map((entry) => <span key={entry.name}><span style={{ color: entry.color }}>●</span> {entry.name}</span>)}<span>┄ Bargain trend</span></div>
  </>;
}

function HistoryTable({ data }: { data: PriceOverview }) {
  const days = [...new Set([...data.retail.history, ...data.market.history].map((point) => point.date))].sort().reverse();
  const cell = (point?: PricePoint, filtered = false) => {
    const price = filtered ? point?.filteredPrice : point?.price;
    return price == null ? '—' : euros(price);
  };
  return <details className="mt-3 text-xs">
    <summary className="cursor-pointer font-semibold text-text-muted">Daily observations ({days.length})</summary>
    <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left">
      <caption className="sr-only">Observed daily asking prices, not completed sale prices</caption>
      <thead><tr><th className="p-2">Date</th><th className="p-2">Retail</th><th className="p-2">Market raw</th><th className="p-2">Market filtered</th></tr></thead>
      <tbody>{days.map((date) => {
        const retail = data.retail.history.find((point) => point.date === date);
        const market = data.market.history.find((point) => point.date === date);
        return <tr key={date} className="border-t border-border"><td className="p-2">{formatDateDmy(date)}</td><td className="p-2">{cell(retail)}</td><td className="p-2">{cell(market)}</td><td className="p-2">{cell(market, true)}{Boolean(market?.excludedCount) && <span className="block text-text-muted">{market!.excludedCount} excluded</span>}</td></tr>;
      })}</tbody>
    </table></div>
  </details>;
}

export function GamePriceOverview({ gameId }: { gameId: number }) {
  const [result, setResult] = useState<{ gameId: number; data?: PriceOverview; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch(`/bgg-account/games/${gameId}/prices`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load price overview.');
        const data = await response.json() as PriceOverview;
        if (active) setResult({ gameId, data });
      } catch {
        if (active) setResult({ gameId, error: 'Unable to load price overview.' });
      }
    })();
    return () => { active = false; };
  }, [gameId, retry]);
  const current = result?.gameId === gameId ? result : null;
  const data = current?.data;
  return <section aria-label="Price overview" className="rounded-md border border-border bg-surface p-3 sm:p-4">
    <h3 className="font-display text-xl">Price overview</h3>
    <p className="mt-1 text-xs text-text-muted">EUR · retail delivery to Greece · tracked daily</p>
    {!current && <p role="status" className="py-4 text-sm text-text-muted">Checking prices...</p>}
    {current?.error && <p role="alert" className="mt-3 text-sm text-accent">{current.error} <button type="button" className="underline" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Retry</button></p>}
    {data && <>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <OfferCard title="Cheapest retail · buy now" source={data.retail} shipping="In stock · includes known shipping and fees" />
        <OfferCard title="Probably cheapest second-hand" source={data.market} shipping="Shipping extra · confirm condition and delivery with seller" />
        <div className="rounded-sm border border-border bg-surface-raised p-3">
          <h4 className="text-xs font-semibold text-text-muted">Bargain price · estimated</h4>
          <p className="mt-1 font-display text-2xl">{data.bargain.price === null ? 'Building history' : euros(data.bargain.price)}</p>
          <p className="mt-2 text-xs text-text-muted">{data.bargain.price === null ? `${data.bargain.sampleDays} observed days; needs at least 5 days spanning 14 days.` : 'A second-hand asking price at or below this trend is a potential bargain. Shipping extra.'}</p>
        </div>
      </div>
      <PriceChart data={data} />
      <HistoryTable data={data} />
      <p className="mt-3 text-xs text-text-muted">History starts when tracking begins; neither API supplies past prices. GeekMarket EUR listings are a proxy for European offers: seller country is unavailable in its feed. These are asking prices, not completed sales.</p>
      <details className="mt-2 text-xs text-text-muted"><summary className="cursor-pointer">How the bargain estimate works</summary><p className="mt-2">Accessory-only descriptions and unusually low prices are excluded using a conservative median-based filter. A robust Theil–Sen trend fits the filtered daily cheapest EUR listing over the last 90 days. Editions, condition and language may differ; filtering cannot guarantee every listing is a complete game.</p></details>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <a href={data.retail.attribution?.url ?? 'https://boardgameprices.co.uk'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 underline">
          {/* Provider requires its supplied logo and backlink alongside prices. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.retail.attribution?.logo ?? 'https://boardgameprices.co.uk/img/meeple-logo-GB.png'} alt="" className="h-5 w-auto" />
          {data.retail.attribution?.name ?? 'BoardGamePrices.co.uk'}
        </a>
        <a href="https://boardgamegeek.com/market" target="_blank" rel="noreferrer" className="underline">BoardGameGeek GeekMarket</a>
      </div>
    </>}
  </section>;
}
