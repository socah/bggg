import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiMutate = jest.fn<(path: string, method: string) => Promise<unknown>>();
const logOut = jest.fn();

jest.unstable_mockModule('@/lib/api', () => ({
  apiMutate,
  ApiError: class ApiError extends Error {},
}));
jest.unstable_mockModule('@/lib/logout', () => ({ logOut }));

const { DeleteAccountSettings } = await import('./delete-account-settings');

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('DeleteAccountSettings', () => {
  it('does nothing when confirmation is cancelled', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DeleteAccountSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(apiMutate).not.toHaveBeenCalled();
  });

  it('deletes the account and signs out after confirmation', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    apiMutate.mockResolvedValue({ ok: true });
    render(<DeleteAccountSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(apiMutate).toHaveBeenCalledWith('/users/me', 'DELETE'));
    expect(logOut).toHaveBeenCalled();
  });
});
