import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn(async (path: string) => {
  const body = path.endsWith('/details')
    ? { reviews: [], plays: [] }
    : path === '/bgg-account'
      ? { account: {} }
      : path === '/bgg-account/lists'
        ? [{ id: 'list-1', name: 'Favorites', type: 'custom', tiers: [], items: [], createdAt: '', updatedAt: '' }]
        : [];
  return { ok: true, json: async () => body } as Response;
});

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));

const { GameDetailsSheet, PersonalCollection } = await import('./personal-collection');

const game = {
  id: 1,
  bggId: 101,
  name: 'Azul',
  image: '/azul-large.jpg',
  thumbnail: '/azul-thumb.jpg',
  minPlayers: 2,
  maxPlayers: 4,
  playingTime: 45,
  yearPublished: 2017,
  rating: 7.8,
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe('GameDetailsSheet history', () => {
  it('consumes browser Back to close the open sheet without another navigation', () => {
    const onOpenChange = jest.fn<(open: boolean) => void>();
    const pushState = jest.spyOn(window.history, 'pushState');
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => undefined);
    render(<GameDetailsSheet game={game} open onOpenChange={onOpenChange} />);

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'Azul cover' }).getAttribute('src')).toBe('/azul-thumb.jpg');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('removes its history entry when the Close button closes the sheet', async () => {
    const onOpenChange = jest.fn<(open: boolean) => void>();
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => undefined);
    render(<GameDetailsSheet game={game} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('does not navigate backward when the open sheet unmounts during route navigation', () => {
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const view = render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} />);

    view.unmount();

    expect(back).not.toHaveBeenCalled();
  });
});

describe('PersonalCollection lists', () => {
  it('starts collapsed and keeps owner list controls on the custom-list accordion', async () => {
    render(<PersonalCollection />);

    const collection = await screen.findByRole('button', { name: 'Collection (0)' });
    const favorites = screen.getByRole('button', { name: 'Favorites (0)' });
    expect(collection.getAttribute('aria-expanded')).toBe('false');
    expect(favorites.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Create a game list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull();

    fireEvent.click(favorites);

    expect(favorites.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete list' })).toBeTruthy();
  });
});
