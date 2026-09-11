import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn<(path: string) => Promise<unknown>>();
const apiMutate = jest.fn<(path: string, method: string, body?: unknown) => Promise<unknown>>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch, apiMutate }));

const { SavedPlaceSettings } = await import('./saved-place-settings');

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('SavedPlaceSettings', () => {
  it('loads places and allows only creator-owned rows to be renamed', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { place: { id: 'place-1', name: 'My cafe' }, canEdit: true },
        { place: { id: 'place-2', name: 'Shared hall' }, canEdit: false },
      ],
    });
    apiMutate.mockResolvedValue({ json: async () => ({ id: 'place-1', name: 'New cafe' }) });
    render(<SavedPlaceSettings />);

    const input = await screen.findByDisplayValue('My cafe');
    expect(screen.getByText('Shared hall')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);

    fireEvent.change(input, { target: { value: 'New cafe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith(
      '/places/place-1',
      'PATCH',
      { name: 'New cafe' },
    ));
    expect(await screen.findByDisplayValue('New cafe')).toBeTruthy();
  });

  it('confirms removal and removes only the caller saved-list row', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ place: { id: 'place-1', name: 'Cafe' }, canEdit: false }],
    });
    apiMutate.mockResolvedValue({});
    render(<SavedPlaceSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(window.confirm).toHaveBeenCalledWith('Remove Cafe from your saved places?');
    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith(
      '/places/place-1/saved',
      'DELETE',
    ));
    expect(await screen.findByText('You do not have any saved places yet.')).toBeTruthy();
  });

  it('shows a useful load error', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Places unavailable' }),
    });
    render(<SavedPlaceSettings />);

    expect((await screen.findByRole('alert')).textContent).toBe('Places unavailable');
  });
});
