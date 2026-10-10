import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PriceOverview, PriceSource } from '@/lib/price-types';

const apiFetch = jest.fn<(path: string, init?: RequestInit) => Promise<Response>>();
jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
const { GamePriceOverview } = await import('./game-price-overview');

const source = (): PriceSource => ({ cheapest: null, offerCount: 0, excludedCount: 0, fetchedAt: '2026-10-07T12:00:00Z', stale: false, error: null, attribution: null, history: [] });
const overview = (): PriceOverview => ({ currency: 'EUR', destination: 'GR', retail: source(), market: source(), bargain: { price: null, sampleDays: 0, trend: [] } });
const response = (data: PriceOverview) => ({ ok: true, json: async () => data }) as Response;

afterEach(() => { cleanup(); apiFetch.mockReset(); });

describe('Game price overview', () => {
  it('flags the specific marketplace listing and displays the recalculated price', async () => {
    const data = overview();
    data.market.cheapest = { price: 20, label: 'Good', url: 'https://boardgamegeek.com/market/product/1' };
    const updated = overview();
    updated.market.cheapest = { price: 30, label: 'Good', url: 'https://boardgamegeek.com/market/product/2' };
    apiFetch.mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(updated));
    const changed = jest.fn();
    window.addEventListener('collection-stats-changed', changed);
    try {
      render(<GamePriceOverview gameId={1} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Flag incorrect listing' }));
      expect(await screen.findByRole('link', { name: '€30.00' })).toHaveProperty('href', updated.market.cheapest.url);
      expect(screen.queryByRole('link', { name: '€20.00' })).toBeNull();
      expect(apiFetch).toHaveBeenLastCalledWith('/bgg-account/games/1/prices/market-exclusions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: data.market.cheapest.url }),
      });
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('collection-stats-changed', changed);
    }
  });

  it('keeps the listing visible and allows retrying when a report fails', async () => {
    const data = overview();
    data.market.cheapest = { price: 20, label: 'Good', url: 'https://boardgamegeek.com/market/product/1' };
    apiFetch.mockResolvedValueOnce(response(data)).mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce(response(overview()));
    render(<GamePriceOverview gameId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Flag incorrect listing' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: '€20.00' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Flag incorrect listing' }));
    await screen.findByText('Listing discarded. Prices and collection estimates recalculated.');
    expect(screen.queryByRole('link', { name: '€20.00' })).toBeNull();
  });

  it('shows delivered retail, secondhand exclusions and provider purchase links', async () => {
    const data = overview();
    data.retail.cheapest = { price: 35, product: 30, shipping: 5, label: 'Game edition', language: 'GB', country: 'GR', url: 'https://boardgameprices.co.uk/item/go?offer=1' };
    data.market.cheapest = { price: 20, label: 'verygood', url: 'https://boardgamegeek.com/market/product/1' };
    data.market.history = [{ date: '2026-10-07', price: 2, filteredPrice: 20, offerCount: 5, excludedCount: 1 }];
    apiFetch.mockResolvedValue(response(data));
    render(<GamePriceOverview gameId={1} />);
    expect(await screen.findByRole('link', { name: '€35.00' })).toHaveProperty('href', data.retail.cheapest.url);
    expect(screen.getByRole('link', { name: '€20.00' }).getAttribute('href')).toBe(data.market.cheapest.url);
    expect(screen.getByText('Game €30.00 · shipping €5.00')).toBeTruthy();
    expect(screen.getByText('Building history')).toBeTruthy();
    expect(screen.getByText(/seller country is unavailable/)).toBeTruthy();
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('€2.00')).toBeTruthy();
    expect(within(table).getByText('1 excluded')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/bgg-account/games/1/prices', { cache: 'no-store' });
  });

  it('shows last known prices with a stale warning when a source fails', async () => {
    const data = overview();
    data.retail.error = 'Retail prices are temporarily unavailable.';
    data.retail.stale = true;
    data.retail.cheapest = { price: 35, label: 'Game', url: 'https://boardgameprices.co.uk/item/go' };
    apiFetch.mockResolvedValue(response(data));
    render(<GamePriceOverview gameId={1} />);
    expect(await screen.findByText('Last known price · may have changed')).toBeTruthy();
    expect(screen.getByText('Retail prices are temporarily unavailable.')).toBeTruthy();
  });

  it('retries a failed overview request', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce(response(overview()));
    render(<GamePriceOverview gameId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Building history')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('ignores responses belonging to a previously selected game', async () => {
    let resolveFirst!: (response: Response) => void;
    apiFetch.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce(response(overview()));
    const view = render(<GamePriceOverview gameId={1} />);
    view.rerender(<GamePriceOverview gameId={2} />);
    await screen.findByText('Building history');
    const old = overview();
    old.retail.cheapest = { price: 999, label: 'Old game', url: 'https://boardgameprices.co.uk/item/go' };
    resolveFirst(response(old));
    await waitFor(() => expect(screen.queryByText('€999.00')).toBeNull());
  });
});
