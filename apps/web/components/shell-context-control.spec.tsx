import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

let pathname = '/calendar';
const back = jest.fn();

jest.unstable_mockModule('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back }),
}));
jest.unstable_mockModule('@/components/group-switcher', () => ({
  GroupSwitcher: () => <p>Group switcher</p>,
}));
jest.unstable_mockModule('@/hooks/use-group-members', () => ({
  useGroupMembers: () => ({
    members: [{ id: 'user-2', username: 'bob', displayName: 'Bob', role: 'member' }],
    loading: false,
  }),
}));

const { ShellContextControl } = await import('./shell-context-control');

describe('ShellContextControl', () => {
  it('uses the group switcher outside selected-user pages', () => {
    pathname = '/calendar';
    render(<ShellContextControl />);
    expect(screen.getByText('Group switcher')).toBeTruthy();
  });

  it('replaces the group switcher with username and back navigation', () => {
    pathname = '/groups/group-1/profile/user-2';
    render(<ShellContextControl />);

    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('Group switcher')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });
});
