import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/hooks/use-group-library', () => ({ useGroupLibrary: jest.fn() }));

const { useGroupLibrary } = await import('@/hooks/use-group-library');
const { GroupLibrary } = await import('./group-library');
const mockUseGroupLibrary = jest.mocked(useGroupLibrary);

afterEach(() => {
  cleanup();
  mockUseGroupLibrary.mockReset();
});

describe('GroupLibrary', () => {
  it('shows a loading status while the library request is pending', () => {
    mockUseGroupLibrary.mockReturnValue({ games: [], loading: true, error: null, reload: jest.fn() });

    render(<GroupLibrary groupId="group-1" />);

    expect(screen.getByRole('status').textContent).toBe('Loading group library...');
  });

  it('shows an error and retries the library request', () => {
    const reload = jest.fn();
    mockUseGroupLibrary.mockReturnValue({
      games: [], loading: false, error: 'Could not load the group game library', reload,
    });

    render(<GroupLibrary groupId="group-1" />);

    expect(screen.getByRole('alert').textContent).toContain('Could not load the group game library');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-library message when no games are available', () => {
    mockUseGroupLibrary.mockReturnValue({ games: [], loading: false, error: null, reload: jest.fn() });

    render(<GroupLibrary groupId="group-1" />);

    expect(screen.getByText(/This group library is empty/)).toBeTruthy();
  });

  it('renders each game thumbnail, name, and player range', () => {
    mockUseGroupLibrary.mockReturnValue({
      games: [{
        id: 1, bggId: 174430, name: 'Gloomhaven', thumbnail: 'https://example.test/gloomhaven.jpg',
        image: 'https://example.test/gloomhaven-large.jpg', minPlayers: 1, maxPlayers: 4,
        playingTime: 120, yearPublished: 2017, rating: 8.6,
        owners: [{ id: 'user-1', username: 'alice', displayName: 'Alice' }],
        averageUserRating: 8,
        averageComplexity: 3,
        averageDepth: 4,
      }],
      loading: false,
      error: null,
      reload: jest.fn(),
    });

    const { container } = render(<GroupLibrary groupId="group-1" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/gloomhaven.jpg');
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    expect(screen.getByRole('heading', { name: 'Gloomhaven' })).toBeTruthy();
    expect(screen.getByLabelText('1–4 players').textContent).toBe('👥 1–4');
    expect(screen.queryByText('2017')).toBeNull();
    expect(screen.getByLabelText('BGG rating 8.6').textContent).toBe('8.6');
    expect(screen.getByLabelText('120 minutes').textContent).toBe('🕒 120′');
    expect(screen.getByText('Owned by Alice')).toBeTruthy();
    expect(screen.getByText('Group avg').parentElement?.textContent).toBe('Group avg · 8/10 · Complexity 3/5 · Depth 4/5');
  });

  it('filters by title and player count', () => {
    mockUseGroupLibrary.mockReturnValue({
      games: [
        { id: 1, bggId: 1, name: 'Azul', thumbnail: null, image: null, minPlayers: 2, maxPlayers: 4, playingTime: 30, yearPublished: 2017, rating: 7, averageUserRating: null, averageComplexity: null, averageDepth: null },
        { id: 2, bggId: 2, name: 'Cascadia', thumbnail: null, image: null, minPlayers: 1, maxPlayers: 4, playingTime: 45, yearPublished: 2021, rating: 8, averageUserRating: null, averageComplexity: null, averageDepth: null },
      ],
      loading: false, error: null, reload: jest.fn(),
    });
    render(<GroupLibrary groupId="group-1" />);

    fireEvent.change(screen.getByLabelText('Filter by title'), { target: { value: 'az' } });
    expect(screen.getByRole('heading', { name: 'Azul' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Cascadia' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Filter by title'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Increase player count'));
    expect((screen.getByLabelText('Player count value') as HTMLInputElement).value).toBe('Player count: 1');
    expect(screen.queryByRole('heading', { name: 'Azul' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Cascadia' })).toBeTruthy();
  });

  it('sorts by group review averages', () => {
    mockUseGroupLibrary.mockReturnValue({
      games: [
        { id: 1, bggId: 1, name: 'Azul', thumbnail: null, image: null, minPlayers: 2, maxPlayers: 4, playingTime: 30, yearPublished: 2017, rating: 8, averageUserRating: 6, averageComplexity: 2, averageDepth: 4 },
        { id: 2, bggId: 2, name: 'Cascadia', thumbnail: null, image: null, minPlayers: 1, maxPlayers: 4, playingTime: 45, yearPublished: 2021, rating: 7, averageUserRating: 9, averageComplexity: 3, averageDepth: 2 },
      ],
      loading: false, error: null, reload: jest.fn(),
    });
    render(<GroupLibrary groupId="group-1" />);

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'userRating' } });

    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Cascadia', 'Azul']);
  });
});
