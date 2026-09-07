import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { UserIdentityLink } from './user-identity-link';

describe('UserIdentityLink', () => {
  it('shows a plain username linked to the group member profile', () => {
    render(
      <UserIdentityLink
        user={{ id: 'user-1', username: 'alice', displayName: 'Alice Example' }}
        groupId="group-1"
      />,
    );

    const link = screen.getByRole('link', { name: 'alice' });
    expect(link.getAttribute('href')).toBe('/groups/group-1/collection/user-1');
    expect(screen.queryByText('@alice')).toBeNull();
  });

  it('renders an unresolved member without a profile link', () => {
    render(
      <UserIdentityLink
        user={{ id: 'stale-user', username: 'unknown-member', displayName: 'Unknown member' }}
        groupId="group-1"
      />,
    );

    expect(screen.getByText('Unknown member')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
