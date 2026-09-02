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
      }],
      loading: false,
      error: null,
      reload: jest.fn(),
    });

    const { container } = render(<GroupLibrary groupId="group-1" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/gloomhaven-large.jpg');
    expect(screen.getByRole('heading', { name: 'Gloomhaven' })).toBeTruthy();
    expect(screen.getByText('1–4 players')).toBeTruthy();
    expect(screen.getByText('2017')).toBeTruthy();
    expect(screen.getByText('8.6 BGG')).toBeTruthy();
    expect(screen.getByText('120 min')).toBeTruthy();
  });
});
