import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { apiFetch as apiFetchType } from '@/lib/api';
import type { GameCardGame } from '@/lib/types';

const apiFetch = jest.fn<typeof apiFetchType>();
jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/components/play-log-dialog', () => ({
  PlayLogDialog: () => null,
}));

const { CalendarPlayLauncher } = await import('./calendar-play-launcher');

const owned: GameCardGame = {
  id: 1, bggId: 101, name: 'Owned game', image: null, thumbnail: null,
  minPlayers: 2, maxPlayers: 4, playingTime: 30, yearPublished: 2020, rating: 8,
};
const saved = { ...owned, id: 2, bggId: 102, name: 'Cafe game' };
const groups = [{ id: 'group-1', name: 'Friends', ownerId: 'me', isSolo: false, createdAt: '' }];

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe('CalendarPlayLauncher', () => {
  it('includes saved-only games, deduplicates owned games, and selects a cafe game for logging', async () => {
    apiFetch.mockImplementation(async (path) => ({
      ok: true,
      json: async () => path === '/bgg-account/saved' ? [owned, saved] : [owned],
    }) as Response);
    const onSelectGame = jest.fn();
    render(<CalendarPlayLauncher date="2026-10-08" groups={groups} defaultGroupId="group-1" onSelectGame={onSelectGame} />);

    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Log a play' }));

    const cafeGame = await screen.findByRole('button', { name: /Cafe game/ });
    expect(screen.getAllByRole('button', { name: /Owned game/ })).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledWith('/groups/group-1/games');
    expect(apiFetch).toHaveBeenCalledWith('/bgg-account/saved');
    fireEvent.click(cafeGame);

    await waitFor(() => expect(onSelectGame).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, name: saved.name }), 'group-1'));
  });

  it('reports a saved-list loading failure', async () => {
    apiFetch.mockImplementation(async (path) => ({
      ok: path !== '/bgg-account/saved', status: 500, json: async () => [owned],
    }) as Response);
    render(<CalendarPlayLauncher date="2026-10-08" groups={groups} defaultGroupId="group-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Log a play' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not load owned and saved games');
  });
});
