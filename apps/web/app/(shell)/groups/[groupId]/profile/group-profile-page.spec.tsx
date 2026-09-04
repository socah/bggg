import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/components/hosting-stats', () => ({
  GroupHostingStats: ({ groupId }: { groupId: string }) => <p>Hosting statistics for {groupId}</p>,
}));

const { default: GroupProfilePage } = await import('./page');

describe('GroupProfilePage', () => {
  it('shows group hosting statistics', async () => {
    const page = await GroupProfilePage({ params: Promise.resolve({ groupId: 'group-1' }) });
    render(page);

    expect(screen.getByText('Hosting statistics for group-1')).toBeTruthy();
  });
});
