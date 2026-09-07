import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const reload = jest.fn();
jest.unstable_mockModule('@/hooks/use-group-members', () => ({
  useGroupMembers: () => ({
    members: [
      { id: 'owner-1', username: 'alice', displayName: 'Alice', role: 'owner' },
      { id: 'member-1', username: 'bob', displayName: 'Bob', role: 'member' },
    ],
    loading: false,
    reload,
  }),
}));
const apiMutate = jest.fn(() => Promise.resolve({}));
jest.unstable_mockModule('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiMutate,
}));

const { GroupSettings } = await import('./group-settings');

describe('GroupSettings', () => {
  it('shows member privileges and allows the owner to change and remove a member', () => {
    render(<GroupSettings groupId="group-1" currentUserId="owner-1" />);

    expect(screen.getByRole('link', { name: 'alice' }).getAttribute('href')).toBe('/groups/group-1/collection/owner-1');
    expect(screen.getByText('owner')).toBeTruthy();
    expect(screen.getByLabelText('Role for bob')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove bob' })).toBeTruthy();
  });

  it('provides a group deletion control only to the owner', () => {
    render(<GroupSettings groupId="group-1" currentUserId="owner-1" />);
    expect(screen.getByRole('button', { name: 'Delete group' })).toBeTruthy();
  });

  it('announces a successful group deletion to persistent navigation', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const deleted = jest.fn();
    window.addEventListener('bggg:group-deleted', deleted);
    render(<GroupSettings groupId="group-1" currentUserId="owner-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));

    await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
    expect((deleted.mock.calls[0][0] as CustomEvent).detail).toEqual({ groupId: 'group-1' });
    window.removeEventListener('bggg:group-deleted', deleted);
  });
});
