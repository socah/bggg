import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn((..._args: unknown[]) => Promise.resolve({
  ok: true,
  json: async () => ({
    username: 'alice',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Anderson',
  }),
}));

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));

const { ProfileSettings } = await import('./profile-settings');

describe('ProfileSettings', () => {
  it('exposes email and names as editable optional fields', async () => {
    render(<ProfileSettings />);

    const email = await screen.findByLabelText(/Email/);
    const firstName = screen.getByLabelText(/First name/);
    const lastName = screen.getByLabelText(/Last name/);

    expect(screen.getAllByText('(optional)')).toHaveLength(3);
    for (const field of [email, firstName, lastName]) {
      expect(field.hasAttribute('required')).toBe(false);
    }
    await waitFor(() => {
      for (const field of [email, firstName, lastName]) {
        expect((field as HTMLInputElement).disabled).toBe(false);
      }
    });
    expect(apiFetch).toHaveBeenCalledWith('/users/me');
  });
});
