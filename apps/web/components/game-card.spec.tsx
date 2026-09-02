import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { GameCard } from './game-card';

describe('GameCard', () => {
  it('renders the complete game metadata used by collections', () => {
    render(
      <GameCard
        game={{
          id: 1,
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
    expect(screen.getByText('2017')).toBeTruthy();
    expect(screen.getByText('8.6 BGG')).toBeTruthy();
    expect(screen.getByText('1–4 players')).toBeTruthy();
    expect(screen.getByText('120 min')).toBeTruthy();
  });
});
