import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn<(path: string, init?: RequestInit) => Promise<Response>>();
jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
const { GamePrivateDetailsForm } = await import('./game-private-details-form');

afterEach(() => { cleanup(); apiFetch.mockReset(); });

describe('GamePrivateDetailsForm', () => {
  it('loads existing values and saves an edited comment and zero purchase price', async () => {
    apiFetch.mockResolvedValue({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} initialDetails={{ comment: 'Original note', amountPaid: 39.95 }} />);
    const comment = screen.getByRole('textbox', { name: 'Private comment' });
    const price = screen.getByRole('spinbutton', { name: 'Amount paid (EUR)' });
    expect((comment as HTMLTextAreaElement).value).toBe('Original note');
    expect((price as HTMLInputElement).value).toBe('39.95');
    fireEvent.change(comment, { target: { value: '  Gift from a friend  ' } });
    fireEvent.change(price, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private details' }));
    await screen.findByText('Private details saved');
    expect(apiFetch).toHaveBeenCalledWith('/bgg-account/games/42/private-details', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Gift from a friend', amountPaid: 0 }),
    });
  });

  it('allows both values to be cleared', async () => {
    apiFetch.mockResolvedValue({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} initialDetails={{ comment: 'Note', amountPaid: 20 }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private details' }));
    await screen.findByText('Private details saved');
    expect(JSON.parse(apiFetch.mock.calls[0][1]?.body as string)).toEqual({ comment: null, amountPaid: null });
  });

  it('retains the draft and allows retrying a failed save', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Save failed' }) } as Response);
    apiFetch.mockResolvedValueOnce({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private details' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep my note');
    await waitFor(() => expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save private details' }));
    await screen.findByText('Private details saved');
  });
});
