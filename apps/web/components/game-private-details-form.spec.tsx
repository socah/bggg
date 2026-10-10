import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn<(path: string, init?: RequestInit) => Promise<Response>>();
jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
const { GamePrivateDetailsForm } = await import('./game-private-details-form');

afterEach(() => { cleanup(); apiFetch.mockReset(); });

describe('GamePrivateDetailsForm', () => {
  it('loads existing values and automatically saves edits after a pause', async () => {
    apiFetch.mockResolvedValue({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} initialDetails={{ comment: 'Original note', amountPaid: 39.95, dateAcquired: '2026-10-01' }} />);
    const comment = screen.getByRole('textbox', { name: 'Private comment' });
    const price = screen.getByRole('spinbutton', { name: 'Amount paid (EUR)' });
    expect((comment as HTMLTextAreaElement).value).toBe('Original note');
    expect((price as HTMLInputElement).value).toBe('39.95');
    expect((screen.getByLabelText('Date acquired') as HTMLInputElement).value).toBe('2026-10-01');
    expect(screen.queryByRole('button')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.change(comment, { target: { value: '  Gift from a friend  ' } });
    fireEvent.change(price, { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Date acquired'), { target: { value: '2026-10-10' } });
    await screen.findByText('Private details saved');
    expect(apiFetch).toHaveBeenCalledWith('/bgg-account/games/42/private-details', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Gift from a friend', amountPaid: 0, dateAcquired: '2026-10-10' }),
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('allows all values to be cleared', async () => {
    apiFetch.mockResolvedValue({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} initialDetails={{ comment: 'Note', amountPaid: 20, dateAcquired: '2026-10-01' }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Date acquired'), { target: { value: '' } });
    await screen.findByText('Private details saved');
    expect(JSON.parse(apiFetch.mock.calls[0][1]?.body as string)).toEqual({ comment: null, amountPaid: null, dateAcquired: null });
  });

  it('retains the draft after a failed save and saves the next edit', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Save failed' }) } as Response);
    apiFetch.mockResolvedValueOnce({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my note' } });
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep my note');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my updated note' } });
    await screen.findByText('Private details saved');
  });

  it('flushes pending edits when the panel closes', async () => {
    apiFetch.mockResolvedValue({ ok: true } as Response);
    const view = render(<GamePrivateDetailsForm gameId={42} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Just before closing' } });
    view.unmount();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(apiFetch.mock.calls[0][1]?.body as string).comment).toBe('Just before closing');
  });

  it('queues newer edits until the earlier save finishes', async () => {
    let finishFirst!: (response: Response) => void;
    apiFetch.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    apiFetch.mockResolvedValueOnce({ ok: true } as Response);
    render(<GamePrivateDetailsForm gameId={42} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First draft' } });
    await screen.findByText('Saving private details...');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Final draft' } });
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    finishFirst({ ok: true } as Response);
    await screen.findByText('Private details saved');
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(apiFetch.mock.calls[1][1]?.body as string).comment).toBe('Final draft');
  });

  it('does not save invalid prices, including on close', async () => {
    const view = render(<GamePrivateDetailsForm gameId={42} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-1' } });
    view.unmount();
    await Promise.resolve();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
