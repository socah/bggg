import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CollectionStats } from '@/lib/collection-stats-types';

const apiFetch = jest.fn<(path: string, init?: RequestInit) => Promise<Response>>();
jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
const { PersonalCollectionStats } = await import('./collection-stats');
const stats = (): CollectionStats => ({ currency: 'EUR', gameCount: 2, acquisitionValue: 40, acquisitionPriceCount: 1,
  estimatedMarketValue: 30, marketPriceCount: 1, stalePriceCount: 0, fallbackDateCount: 1,
  growth: [{ month: '2026-01', acquired: 1, collectionSize: 1, recordedSpend: 40 }, { month: '2026-10', acquired: 1, collectionSize: 2, recordedSpend: 40 }],
  games: [{ gameId: 1, name: 'Azul', amountPaid: 40, dateAcquired: '2026-01-10', addedAt: '2026-10-10', estimatedValue: 30, basis: 'retail-minus-25-percent', stale: false },
    { gameId: 2, name: 'Catan', amountPaid: null, dateAcquired: null, addedAt: '2026-10-10', estimatedValue: null, basis: null, stale: true }],
});
const response = (data: CollectionStats) => ({ ok: true, json: async () => data }) as Response;
afterEach(() => { cleanup(); apiFetch.mockReset(); });

describe('Private profile collection statistics', () => {
  it('shows totals, coverage, growth and per-game valuation basis', async () => {
    apiFetch.mockResolvedValue(response(stats()));
    render(<PersonalCollectionStats />);
    await screen.findByText('Purchase prices recorded for 1 of 2 games');
    expect(screen.getByText('Prices available for 1 of 2 games')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Collection growth over time/ })).toBeTruthy();
    expect(screen.getByText(/1 games use the date added/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Private collection acquisition prices and estimated values by game', hidden: true });
    expect(within(table).getByText('Retail − 25%')).toBeTruthy();
    expect(within(table).getByText('Unavailable')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/bgg-account/collection-stats', { cache: 'no-store' });
  });

  it('refreshes estimated value when a listing report or private edit changes stats', async () => {
    apiFetch.mockResolvedValueOnce(response(stats())).mockResolvedValueOnce(response({ ...stats(), estimatedMarketValue: 50 }));
    render(<PersonalCollectionStats />);
    await screen.findByText('Prices available for 1 of 2 games');
    fireEvent(window, new Event('collection-stats-changed'));
    expect(await screen.findByText('€50.00')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('retries failed loads using refresh', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce(response(stats()));
    render(<PersonalCollectionStats />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh collection stats' }));
    await screen.findByText('Games owned');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows an empty collection and no invented market value', async () => {
    apiFetch.mockResolvedValue(response({ ...stats(), gameCount: 0, acquisitionValue: 0, acquisitionPriceCount: 0,
      estimatedMarketValue: null, marketPriceCount: 0, fallbackDateCount: 0, growth: [], games: [] }));
    render(<PersonalCollectionStats />);
    await screen.findByText('Add games to your collection to start tracking growth and value.');
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
