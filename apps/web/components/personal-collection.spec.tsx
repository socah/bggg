import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
  const body = path.endsWith('/review') && init?.method === 'PUT'
    ? { id: 1, userId: 'me', gameId: 1, rating: 8.5, complexityScore: null, depthScore: null, body: null, source: 'manual', updatedAt: '2026-09-01T00:00:00.000Z' }
    : path.endsWith('/details')
    ? { reviews: [], plays: [] }
    : path === '/bgg-account'
      ? { account: {} }
      : path === '/bgg-account/lists'
        ? [{ id: 'list-1', name: 'Favorites', type: 'custom', tiers: [], items: [{ id: 1, bggId: 101, name: 'Azul', image: null, thumbnail: null, minPlayers: 2, maxPlayers: 4, playingTime: 45, yearPublished: 2017, rating: 7.8, tier: null, position: 0 }], createdAt: '', updatedAt: '' }]
        : path === '/bgg-account/games'
          ? [
            { id: 2, bggId: 102, name: 'Azul: Summer Pavilion', thumbnail: '/summer.jpg', image: null, minPlayers: 2, maxPlayers: 4, playingTime: 45, yearPublished: 2019, rating: 8, source: 'manual', addedAt: '' },
            { id: 3, bggId: 103, name: 'Catan', thumbnail: '/catan.jpg', image: null, minPlayers: 3, maxPlayers: 4, playingTime: 60, yearPublished: 1995, rating: 7, source: 'manual', addedAt: '' },
          ]
          : path === '/bgg-account/wishlist'
            ? [{ id: 4, bggId: 104, name: 'Solo Game', thumbnail: '/solo.jpg', image: null, minPlayers: 1, maxPlayers: 1, playingTime: 30, yearPublished: 2025, rating: 8, source: 'manual', addedAt: '', wishlistPriority: 1 }]
            : path.startsWith('/bgg-account/search')
              ? [{ bggId: 101, name: 'Azul', thumbnail: '/azul.jpg', yearPublished: 2017 }, { bggId: 999, name: 'Unknown Game', thumbnail: null, yearPublished: 2020 }]
              : [];
  return { ok: true, json: async () => body } as Response;
});
const defaultApiFetch = apiFetch.getMockImplementation()!;

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/components/play-log-dialog', () => ({
  PlayLogDialog: ({ open, defaults }: { open: boolean; defaults?: { groupId: string } }) => open ? <div data-testid="play-log-group">{defaults?.groupId ?? 'fallback'}</div> : null,
}));
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
  apiFetch.mockImplementation(defaultApiFetch);
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

describe('GameDetailsSheet interactions', () => {
  it('opens the most extensive review and keeps the personal review switch available', async () => {
    apiFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      reviews: [
        { id: 1, userId: 'me', displayName: 'Alice', username: 'alice', profileGroupId: null, isMine: true, rating: 8, complexityScore: null, depthScore: null, body: 'Mine.', source: 'manual', updatedAt: '2026-09-01T00:00:00.000Z' },
        { id: 2, userId: 'bob', displayName: 'Bob', username: 'bob', profileGroupId: null, isMine: false, rating: 9, complexityScore: 3, depthScore: 4, body: '## The long view\n\nThis is the substantially longer review of the game.', source: 'manual', updatedAt: '2026-09-02T00:00:00.000Z' },
      ],
      plays: [],
    }) } as Response));

    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} />);

    expect(await screen.findByRole('heading', { name: 'The long view' })).toBeTruthy();
    const mine = screen.getByRole('button', { name: 'Your review' });
    expect(mine).toBeTruthy();
    fireEvent.click(mine);
    expect(await screen.findByText('Mine.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('logs a play in the group that opened the game details', async () => {
    render(<GameDetailsSheet game={game} groupId="group-created" open onOpenChange={jest.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log a play' }));
    expect(screen.getByTestId('play-log-group').textContent).toBe('group-created');
  });

  it('autosaves a review after a field changes', async () => {
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} />);
    const rating = await screen.findByRole('spinbutton', { name: 'Rating' });

    fireEvent.change(rating, { target: { value: '8.5' } });

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) => path === '/bgg-account/games/1/review' && init?.method === 'PUT')).toBe(true), { timeout: 2000 });
    expect(await screen.findByText('Review saved')).toBeTruthy();
  });

  it('adds to a list as soon as the list is selected', async () => {
    const onMutate = jest.fn<(path: string, init: RequestInit, success: string) => Promise<boolean>>(async () => true);
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} lists={[{ id: 'list-2', name: 'Weekend', type: 'custom', tiers: [], items: [], createdAt: '', updatedAt: '' }]} onMutate={onMutate} />);
    const selector = await screen.findByRole('combobox', { name: 'Add list tag' });

    fireEvent.change(selector, { target: { value: 'list-2' } });

    await waitFor(() => expect(onMutate).toHaveBeenCalledWith('/bgg-account/lists/list-2/games', expect.objectContaining({ method: 'POST' }), 'Added Azul to Weekend.'));
  });

  it('shows memberships as editable tags in the personal review', async () => {
    apiFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({
      reviews: [{ id: 1, userId: 'me', displayName: 'Alice', username: 'alice', profileGroupId: null, isMine: true, rating: 8, complexityScore: null, depthScore: null, body: 'Mine.', source: 'manual', updatedAt: '2026-09-01T00:00:00.000Z' }],
      plays: [],
    }) } as Response));
    const onMutate = jest.fn<(path: string, init: RequestInit, success: string) => Promise<boolean>>(async () => true);
    const collectionGame = { ...game, source: 'manual' as const, addedAt: '' };
    const weekend = { id: 'list-2', name: 'Weekend', type: 'custom' as const, tiers: [], items: [{ ...game, tier: null, position: 0 }], createdAt: '', updatedAt: '' };
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} collectionGame={collectionGame} lists={[weekend]} onMutate={onMutate} />);

    expect(await screen.findByText('Mine.')).toBeTruthy();
    expect(screen.getByLabelText('Game lists').textContent).toContain('Collection');
    expect(screen.getByLabelText('Game lists').textContent).toContain('Weekend');
    expect(screen.queryByText('Additional info')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Weekend tag' }));

    await waitFor(() => expect(onMutate).toHaveBeenCalledWith('/bgg-account/lists/list-2/games/1', { method: 'DELETE' }, ''));
  });

  it('keeps BGG-managed membership tags non-removable', async () => {
    const collectionGame = { ...game, source: 'bgg' as const, addedAt: '' };
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} collectionGame={collectionGame} onMutate={jest.fn(async () => true)} />);

    expect(await screen.findByText('Collection')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Collection tag' })).toBeNull();
    expect(screen.getByTitle('Managed by BoardGameGeek')).toBeTruthy();
  });

  it('allows manual wishlist priority changes from game details', async () => {
    const onMutate = jest.fn<(path: string, init: RequestInit, success: string) => Promise<boolean>>(async () => true);
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} wishlistGame={{ ...game, source: 'manual', addedAt: '', wishlistPriority: 3 }} onMutate={onMutate} />);
    fireEvent.change(screen.getByLabelText('Wishlist priority for Azul'), { target: { value: '2' } });
    expect(onMutate).toHaveBeenCalledWith('/bgg-account/wishlist/1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ wishlistPriority: 2 }) }), '');
    await screen.findByText('Write your review');
  });

  it('explains where to change a BGG-synced wishlist priority', async () => {
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} wishlistGame={{ ...game, source: 'bgg', addedAt: '', wishlistPriority: 1 }} onMutate={jest.fn(async () => true)} />);
    expect(screen.getByText('P1 · Must have')).toBeTruthy();
    expect(screen.queryByLabelText('Wishlist priority for Azul')).toBeNull();
    expect(screen.getByText('Change priority on BoardGameGeek, then sync.')).toBeTruthy();
    await screen.findByText('Write your review');
  });
});

describe('PersonalCollection lists', () => {
  it('starts collapsed and keeps list settings between the name and right toggle', async () => {
    render(<PersonalCollection />);

    const collection = await screen.findByRole('button', { name: 'Collection (2)' });
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

  it('offers secondary sorts without exposing wishlist priority as an option', async () => {
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Wishlist (1)' }));

    const sort = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(sort.value).toBe('display:name');
    expect(Array.from(sort.options, (option) => option.value)).not.toContain('priority');
    expect(Array.from(sort.options, (option) => option.textContent)).toEqual(expect.arrayContaining(['User rating', 'Complexity', 'Depth']));
  });

  it('keeps wishlist priority first, sorts within priorities, and saves manual priority edits', async () => {
    let wishlist = [
      { ...game, id: 10, name: 'Zulu', wishlistPriority: 1, rating: 1, source: 'manual', addedAt: '' },
      { ...game, id: 11, name: 'Alpha', wishlistPriority: 2, rating: 5, source: 'manual', addedAt: '' },
      { ...game, id: 12, name: 'Beta', wishlistPriority: 2, rating: 9, source: 'manual', addedAt: '' },
      { ...game, id: 13, name: 'Aardvark', wishlistPriority: 3, rating: 10, source: 'bgg', addedAt: '' },
    ];
    apiFetch.mockImplementation(async (path, init) => {
      if (path === '/bgg-account/wishlist/12' && init?.method === 'PATCH') {
        const { wishlistPriority } = JSON.parse(String(init.body)) as { wishlistPriority: number };
        wishlist = wishlist.map((item) => item.id === 12 ? { ...item, wishlistPriority } : item);
        return { ok: true, json: async () => wishlist[2] } as Response;
      }
      if (path === '/bgg-account/wishlist') return { ok: true, json: async () => wishlist } as Response;
      return defaultApiFetch(path, init);
    });
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Wishlist (4)' }));
    const titles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(titles()).toEqual(['Zulu', 'Alpha', 'Beta', 'Aardvark']);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'rating' } });
    expect(titles()).toEqual(['Zulu', 'Beta', 'Alpha', 'Aardvark']);
    expect(screen.getByText('P1 · Must have')).toBeTruthy();
    expect(screen.queryByLabelText('Wishlist priority for Aardvark')).toBeNull();
    expect(screen.getByText('P3 · Like to have').getAttribute('title')).toBe('Priority managed by BoardGameGeek');

    fireEvent.change(screen.getByLabelText('Wishlist priority for Beta'), { target: { value: '1' } });
    await waitFor(() => expect(titles()).toEqual(['Beta', 'Zulu', 'Alpha', 'Aardvark']));
    expect(apiFetch.mock.calls.some(([path, init]) => path === '/bgg-account/wishlist/12' && init?.method === 'PATCH' && JSON.parse(String(init.body)).wishlistPriority === 1)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByLabelText('Wishlist priority for Beta')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collection (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wishlist (4)' }));
    expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe('display:rating');
  });

  it('filters all collapsed previews and hides empty lists as text and player count change', async () => {
    render(<PersonalCollection />);
    await screen.findByRole('button', { name: 'Collection (2)' });
    expect(screen.queryByRole('button', { name: 'Saved (0)' })).toBeNull();
    expect(screen.getAllByLabelText('Player count value')).toHaveLength(1);
    const search = screen.getByRole('textbox', { name: 'Search your lists and BoardGameGeek' });
    fireEvent.change(search, { target: { value: 'aZuL' } });

    expect(screen.getByRole('button', { name: 'Collection (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Favorites (1)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wishlist (1)' })).toBeNull();
    const previewIds = screen.getAllByTestId('collection-list-preview').flatMap((preview) => Array.from(preview.querySelectorAll('img'), (img) => img.getAttribute('data-game-id')));
    expect(previewIds).toEqual(['2']);

    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '5' } });
    expect(screen.queryByRole('button', { name: /^(Collection|Favorites) \(/ })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'Wishlist (1)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collection (2)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Favorites (1)' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Collection (2)' })).toBeTruthy();
  });

  it('dynamically reduces expanded lists with the unified search', async () => {
    render(<PersonalCollection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collection (2)' }));
    expect(screen.getByRole('heading', { name: 'Catan' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search your lists and BoardGameGeek' }), { target: { value: 'azul' } });
    expect(screen.getByRole('heading', { name: 'Azul: Summer Pavilion' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Catan' })).toBeNull();
    expect(screen.queryByLabelText('Filter by title')).toBeNull();
  });

  it('opens the exact match from a custom list on Enter before BGG results arrive', async () => {
    render(<PersonalCollection />);
    await screen.findByRole('button', { name: 'Favorites (1)' });
    const search = screen.getByRole('textbox', { name: 'Search your lists and BoardGameGeek' });
    fireEvent.change(search, { target: { value: 'azul' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Azul' })).toBeTruthy();
  });

  it('opens details for BGG results already in any list and preserves add actions', async () => {
    render(<PersonalCollection />);
    await screen.findByRole('button', { name: 'Favorites (1)' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search your lists and BoardGameGeek' }), { target: { value: 'azul' } });
    const result = await screen.findByRole('button', { name: 'Open details for Azul' });
    expect(screen.queryByRole('button', { name: 'Open details for Unknown Game' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Own' })).toHaveLength(2);
    fireEvent.click(result);
    expect(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Azul' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open details for Azul' })).toBeNull();
  });

  it('uses a prefix match on Enter and respects the player-count filter', async () => {
    render(<PersonalCollection />);
    await screen.findByRole('button', { name: 'Favorites (1)' });
    const search = screen.getByRole('textbox', { name: 'Search your lists and BoardGameGeek' });
    fireEvent.change(search, { target: { value: 'azu' } });
    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '5' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(search, { target: { value: 'missing title' } });
    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(search, { target: { value: 'azu' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Azul' })).toBeTruthy();
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

  it('keeps the details header limited to game metadata', async () => {
    render(<GameDetailsSheet game={game} open onOpenChange={jest.fn()} />);

    await screen.findByText('Write your review');
    const title = screen.getByRole('link', { name: 'Azul' });
    expect(title.getAttribute('href')).toBe('https://boardgamegeek.com/boardgame/101');
    expect(title.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText('Community notebook')).toBeNull();
    expect(screen.queryByText('Player reviews')).toBeNull();
    expect(screen.getByLabelText('BGG rating 7.8').textContent).toBe('7.8');
    expect(screen.getByLabelText('2–4 players').textContent).toBe('👥 2–4');
    expect(screen.getByLabelText('45 minutes').textContent).toBe('🕒 45′');
    expect(screen.queryByText('2017')).toBeNull();
  });
});
