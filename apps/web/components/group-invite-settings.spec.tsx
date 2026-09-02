import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

jest.unstable_mockModule('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiMutate: jest.fn(() => Promise.resolve({
    json: async () => ({ inviteUrl: 'https://example.com/invites/test-token' }),
  })),
}));

jest.unstable_mockModule('qrcode.react', () => ({
  QRCodeCanvas: ({ 'aria-label': label, value }: { 'aria-label'?: string; value: string }) =>
    createElement('div', { role: 'img', 'aria-label': label, 'data-value': value }),
}));

const { GroupInviteSettings } = await import('./group-invite-settings');

describe('GroupInviteSettings', () => {
  it('displays a QR code for the generated invite URL', async () => {
    render(<GroupInviteSettings groupId="group-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    const qrCode = await screen.findByRole('img', { name: 'Invite QR code' });
    expect(qrCode.getAttribute('data-value')).toBe('https://example.com/invites/test-token');
  });
});
