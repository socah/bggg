import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { GamePickerDialog } from './game-picker-dialog';

const game = { id: 1, bggId: 230802, name: 'Azul', thumbnail: '/azul.jpg', image: null, minPlayers: 2, maxPlayers: 4, playingTime: 45, yearPublished: 2017, rating: 7.8 };

afterEach(cleanup);

describe('GamePickerDialog', () => {
  it('keeps the picker open and marks a clicked game as added', async () => {
    function Harness() {
      const [added, setAdded] = useState(new Set<number>());
      return <GamePickerDialog open title="Add suggested games" games={[game]} addedIds={added} onOpenChange={jest.fn()} onAdd={async (selected) => { setAdded(new Set([selected.id])); return true; }} />;
    }
    const { container } = render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /Azul/ }));

    await waitFor(() => expect(screen.getByLabelText('Added')).toBeTruthy());
    expect(screen.getByText('Add suggested games')).toBeTruthy();
    expect(container.ownerDocument.querySelector('img')?.getAttribute('src')).toBe('/azul.jpg');
    expect(screen.queryByLabelText('BGG rating 7.8')).toBeNull();
  });

  it('supports thumbnail-based single selection without ticks', async () => {
    const onOpenChange = jest.fn();
    const onAdd = jest.fn<(selected: typeof game) => Promise<boolean>>(async () => true);
    render(<GamePickerDialog singleSelect open title="Choose a game" games={[game]} onOpenChange={onOpenChange} onAdd={onAdd} />);
    const row = screen.getByRole('button', { name: /Azul/ });
    expect(row.getAttribute('aria-pressed')).toBeNull();
    expect(screen.queryByLabelText('Added')).toBeNull();

    fireEvent.click(row);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(game));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
