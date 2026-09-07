import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

let pathname = '/groups/group-1/calendar';

jest.unstable_mockModule('next/navigation', () => ({
  usePathname: () => pathname,
}));

const { ViewTabs } = await import('./view-tabs');

describe('ViewTabs', () => {
  it('links to the group profile from group space', () => {
    render(<ViewTabs />);

    expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/groups/group-1/profile');
  });

  it('does not mark a view active on a settings page', () => {
    pathname = '/settings';
    render(<ViewTabs />);

    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('shows only collection and profile while preserving the selected user', () => {
    pathname = '/groups/group-1/profile/user-2';
    render(<ViewTabs />);

    expect(screen.queryByRole('link', { name: 'Calendar' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Collection' }).getAttribute('href'))
      .toBe('/groups/group-1/collection/user-2');
    expect(screen.getByRole('link', { name: 'Profile', current: 'page' }).getAttribute('href'))
      .toBe('/groups/group-1/profile/user-2');
  });
});
