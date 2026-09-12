import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
  void init;
  const body = path.endsWith('/details')
    ? { reviews: [], plays: [] }
    : path === '/bgg-account'
      ? { account: {} }
      : path === '/bgg-account/lists'
        ? [{ id: 'list-1', name: 'Favorites', type: 'custom', tiers: [], items: [{ id: 1, bggId: 101, name: 'Azul', image: null, thumbnail: null, minPlayers: 2, maxPlayers: 4, playingTime: 45, yearPublished: 2017, rating: 7.8, tier: null, position: 0 }], createdAt: '', updatedAt: '' }]
        : [];
  return { ok: true, json: async () => body } as Response;
});

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => <button type="button" role="menuitem" onClick={onSelect}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

const { gameMembershipLabels, GameDetailsSheet, LibraryGame, PersonalCollection } = await import('./personal-collection');

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
  it('starts collapsed and keeps list settings between the name and right toggle', async () => {
    render(<PersonalCollection />);

    const collection = await screen.findByRole('button', { name: 'Collection (0)' });
    const favorites = screen.getByRole('button', { name: 'Favorites (1)' });
    expect(collection.getAttribute('aria-expanded')).toBe('false');
    expect(favorites.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Create a game list')).toBeTruthy();
    const settings = screen.getByRole('button', { name: 'Favorites settings' });
    expect(settings).toBeTruthy();
    expect(settings.parentElement?.nextElementSibling?.textContent).toBe('(1)');
    expect(settings.parentElement?.nextElementSibling?.nextElementSibling?.getAttribute('aria-label')).toBe('Expand Favorites');

    fireEvent.click(screen.getByRole('button', { name: 'Expand Favorites' }));

    expect(favorites.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Collapse Favorites' })).toBeTruthy();
  });

  it('offers rename and delete from one list settings menu', async () => {
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites settings' }));

    expect(await screen.findByRole('menuitem', { name: 'Rename list' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete list' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename list' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'List name' }), { target: { value: 'Best games' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) => path === '/bgg-account/lists/list-1' && init?.method === 'PATCH' && JSON.parse(String(init.body)).name === 'Best games')).toBe(true));
  });

  it('toggles list editing from the settings menu', async () => {
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (1)' }));
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enter edit mode' }));

    expect(screen.getByRole('menuitem', { name: 'Exit edit mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('does not show a success message after creating a list', async () => {
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByLabelText('Create a game list'));
    fireEvent.change(screen.getByPlaceholderText('List name'), { target: { value: 'Weekend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) => path === '/bgg-account/lists' && init?.method === 'POST')).toBe(true));
    expect(screen.queryByText('Created custom list.')).toBeNull();
  });

  it('defaults wishlists to priority sorting and offers review sorts', async () => {
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Wishlist (0)' }));

    const sort = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(sort.value).toBe('display:priority');
    expect(Array.from(sort.options, (option) => option.textContent)).toEqual(expect.arrayContaining(['User rating', 'Complexity', 'Depth']));
  });
});

describe('LibraryGame metadata', () => {
  it('derives default and custom memberships independently', () => {
    const labels = gameMembershipLabels(
      game.id,
      [{ ...game, source: 'manual', addedAt: '' }],
      [],
      [{ ...game, source: 'manual', addedAt: '' }],
      [{ id: 'list-1', name: 'Favorites', type: 'custom', tiers: [], items: [{ ...game, tier: null, position: 0 }], createdAt: '', updatedAt: '' }],
    );

    expect(labels.defaults).toEqual(['Collection', 'Saved']);
    expect(labels.custom).toEqual(['Favorites']);
  });

  it('shows memberships and a review excerpt without a release-year badge', () => {
    render(<LibraryGame game={game} view="list" onOpen={jest.fn()} listLabels={['Favorites']} review={{ id: 1, gameId: game.id, rating: 9, complexityScore: 2, depthScore: 3, body: 'Excellent with two players.', source: 'manual', updatedAt: '' }} />);

    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getByText('Favorites').className).toContain('bg-accent-2');
    expect(screen.getByText('9/10 · Complexity 2/5 · Depth 3/5')).toBeTruthy();
    expect(screen.getByText('Excellent with two players.')).toBeTruthy();
    expect(screen.queryByText('2017')).toBeNull();
  });

  it('shows list and game metadata in the details header', async () => {
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} membershipLabels={['Collection', 'Favorites']} />);

    expect(await screen.findByText('Collection')).toBeTruthy();
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getByLabelText('BGG rating 7.8').textContent).toBe('7.8');
    expect(screen.getByLabelText('2–4 players').textContent).toBe('👥 2–4');
    expect(screen.getByLabelText('45 minutes').textContent).toBe('🕒 45′');
    expect(screen.queryByText('2017')).toBeNull();
  });
});
