import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const reload = jest.fn();
jest.unstable_mockModule('@/hooks/use-group-members', () => ({
  useGroupMembers: () => ({
    members: [
      { id: 'owner-1', displayName: 'Alice', role: 'owner' },
      { id: 'member-1', displayName: 'Bob', role: 'member' },
    ],
    loading: false,
    reload,
  }),
}));
jest.unstable_mockModule('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiMutate: jest.fn(() => Promise.resolve({})),
}));

const { GroupSettings } = await import('./group-settings');

describe('GroupSettings', () => {
  it('shows member privileges and allows the owner to change and remove a member', () => {
    render(<GroupSettings groupId="group-1" currentUserId="owner-1" />);

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('owner')).toBeTruthy();
    expect(screen.getByLabelText('Role for Bob')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeTruthy();
  });

  it('provides a group deletion control only to the owner', () => {
    render(<GroupSettings groupId="group-1" currentUserId="owner-1" />);
    expect(screen.getByRole('button', { name: 'Delete group' })).toBeTruthy();
  });
});
