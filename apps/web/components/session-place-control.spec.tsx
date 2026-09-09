import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn<(path: string) => Promise<Response>>();
const apiMutate = jest.fn<(path: string, method: string, body: unknown) => Promise<Response>>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch, apiMutate }));

const { SessionPlaceControl } = await import('./session-place-control');

describe('SessionPlaceControl', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('sets a saved place on the session', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [{ place: { id: 'place-1', name: "Alice's home" } }] } as Response);
    apiMutate.mockResolvedValue({ ok: true, json: async () => ({ place: { id: 'place-1', name: "Alice's home" } }) } as Response);
    const onChanged = jest.fn();
    render(<SessionPlaceControl groupId="group-1" sessionId="session-1" place={null} canEdit onChanged={onChanged} />);

    const select = await screen.findByRole('combobox', { name: 'Session place' });
    await screen.findByRole('option', { name: "Alice's home" });
    fireEvent.change(select, { target: { value: 'place-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    await waitFor(() => {
      expect(apiMutate).toHaveBeenCalledWith('/groups/group-1/sessions/session-1/place', 'PATCH', { placeId: 'place-1' });
      expect(onChanged).toHaveBeenCalledWith({ id: 'place-1', name: "Alice's home" });
    });
  });
});
