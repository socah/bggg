import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn((path: string) => {
  void path;
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ hostedSessionCount: 4 }),
  });
});

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/hooks/use-group-members', () => ({
  useGroupMembers: () => ({ members: [], loading: false }),
}));

const { MemberHostingStats } = await import('./hosting-stats');

describe('MemberHostingStats', () => {
  it('loads the selected member group history', async () => {
    render(<MemberHostingStats groupId="group-1" userId="user-2" />);

    await waitFor(() => expect(screen.getByText('4')).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith('/groups/group-1/members/user-2/hosting-stats');
    expect(screen.getByText('confirmed sessions hosted in this group')).toBeTruthy();
  });
});
