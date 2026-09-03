import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiMutate: jest.fn(() => Promise.resolve({
    json: async () => ({ inviteUrl: 'https://example.com/invites/test-token' }),
  })),
}));

const { GroupInviteSettings } = await import('./group-invite-settings');

describe('GroupInviteSettings', () => {
  it('displays a QR code for the generated invite URL', async () => {
    render(<GroupInviteSettings groupId="group-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    const qrCode = await screen.findByRole('img', { name: 'Invite QR code' });
    expect(qrCode.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText('https://example.com/invites/test-token')).toBeTruthy();
  });
});
