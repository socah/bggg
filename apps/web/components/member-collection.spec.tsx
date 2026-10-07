import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GameCardGame, GroupMemberProfile } from '@/lib/types';

const game = (id: number, name: string): GameCardGame => ({
  id,
  bggId: id + 1000,
  name,
  image: null,
  thumbnail: null,
  minPlayers: 1,
  maxPlayers: 4,
  playingTime: 60,
  yearPublished: 2025,
  rating: 8,
});

const member: GroupMemberProfile = {
  id: 'user-2',
  username: 'bob',
  displayName: 'Bob Example',
  role: 'member',
  isCurrentUser: false,
  collection: [{ ...game(1, 'Owned Game'), thumbnail: '/thumb.jpg', image: '/full.jpg', source: 'manual', addedAt: '2026-09-01' }],
  wishlist: [{ ...game(2, 'Wanted Game'), source: 'bgg', addedAt: '2026-09-02', wishlistPriority: 2 }],
  saved: [{ ...game(3, 'Saved Game'), source: 'manual', addedAt: '2026-09-03' }],
  lists: [{
    id: 'list-1',
    name: 'Favorites',
    type: 'custom',
    tiers: [],
    items: [{ ...game(4, 'Favorite Game'), tier: null, position: 0 }],
    createdAt: '2026-09-04',
    updatedAt: '2026-09-04',
  }],
  reviews: [],
};

const apiFetch = jest.fn((path: string) => {
  void path;
  return Promise.resolve({ ok: true, json: () => Promise.resolve(member) });
});

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));

const { MemberCollection } = await import('./member-collection');

describe('MemberCollection', () => {
  it('loads every selected-member list without owner controls', async () => {
    render(<MemberCollection groupId="group-1" userId="user-2" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Collection (1)' })).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith('/groups/group-1/members/user-2');
    expect(screen.getByRole('button', { name: 'Wishlist (1)' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Saved (1)' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Favorites (1)' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Collection (1)' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByTestId('collection-list-preview')[0].querySelector('img')?.getAttribute('src')).toBe('/thumb.jpg');
    expect(screen.queryByText('Owned Game')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Collection (1)' }));
    expect(screen.getByRole('button', { name: 'Collection (1)' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Owned Game')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/thumb.jpg');
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    fireEvent.click(screen.getByRole('button', { name: 'Collection (1)' }));
    expect(screen.getByRole('button', { name: 'Collection (1)' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Favorites (1)' }));
    expect(screen.getByRole('button', { name: 'Favorites (1)' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Favorite Game')).toBeTruthy();
    expect(screen.queryByText('Sync BGG')).toBeNull();
    expect(screen.queryByLabelText('Create a game list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Wishlist (1)' }));
    const sort = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(sort.value).toBe('display:name');
    expect(Array.from(sort.options, (option) => option.value)).not.toContain('priority');
    expect(screen.getByText('P2 · Love to have')).toBeTruthy();
    expect(screen.queryByLabelText('Wishlist priority for Wanted Game')).toBeNull();
    expect(Array.from(sort.options, (option) => option.textContent)).toEqual(expect.arrayContaining(['User rating', 'Complexity', 'Depth']));

    expect(screen.getAllByLabelText('Player count value')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search by title'), { target: { value: 'owned' } });
    expect(screen.getByRole('button', { name: 'Collection (1)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wishlist (1)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Favorites (1)' })).toBeNull();
    expect(screen.getAllByTestId('collection-list-preview')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '5' } });
    expect(screen.queryByRole('button', { name: 'Collection (1)' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Player count value'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search by title'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Wishlist (1)' })).toBeTruthy();
  });
});
