import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { GameCard } from './game-card';

describe('GameCard', () => {
  it('renders the complete game metadata used by collections', () => {
    render(
      <GameCard
        game={{
      id: 1,
      bggId: 174430,
          name: 'Gloomhaven',
          image: 'https://example.test/gloomhaven-large.jpg',
          thumbnail: 'https://example.test/gloomhaven-thumb.jpg',
          minPlayers: 1,
          maxPlayers: 4,
          playingTime: 120,
          yearPublished: 2017,
          rating: 8.6,
        }}
      />,
    );

    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.test/gloomhaven-large.jpg');
    expect(screen.getByRole('heading', { name: 'Gloomhaven' })).toBeTruthy();
    expect(screen.queryByText('2017')).toBeNull();
    expect(screen.getByLabelText('BGG rating 8.6').textContent).toBe('8.6');
    expect(screen.getByLabelText('1–4 players').textContent).toBe('👥 1–4');
    expect(screen.getByLabelText('120 minutes').textContent).toBe('🕒 120′');
  });
});
