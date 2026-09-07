import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/components/hosting-stats', () => ({
  MemberHostingStats: ({ groupId, userId }: { groupId: string; userId: string }) => (
    <p>Hosting stats for {userId} in {groupId}</p>
  ),
}));

const { MemberProfile } = await import('./member-profile');

describe('MemberProfile', () => {
  it('shows the selected member profile statistics', () => {
    render(<MemberProfile groupId="group-1" userId="user-2" />);
    expect(screen.getByText('Hosting stats for user-2 in group-1')).toBeTruthy();
  });
});
