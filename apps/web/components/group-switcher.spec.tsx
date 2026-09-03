import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Group } from '@/lib/types';

let pathname = '/groups/group-1/settings';
const router = { push: jest.fn() };
const apiFetch = jest.fn<(
  path: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<Group[]> }>>();

jest.unstable_mockModule('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
}));
jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { GroupSwitcher } = await import('./group-switcher');

const deletedGroup: Group = {
  id: 'group-1',
  name: 'Deleted group',
  ownerId: 'owner-1',
  isSolo: false,
  createdAt: '2026-09-03T00:00:00.000Z',
};

describe('GroupSwitcher', () => {
  beforeEach(() => {
    pathname = '/groups/group-1/settings';
    apiFetch.mockReset();
  });

  it('removes a deleted group after navigation leaves its group space', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [deletedGroup] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    const { rerender } = render(<GroupSwitcher />);
    expect((await screen.findAllByText('Deleted group')).length).toBeGreaterThan(0);

    pathname = '/calendar';
    rerender(<GroupSwitcher />);

    await waitFor(() => expect(screen.queryByText('Deleted group')).toBeNull());
  });

  it('removes an announced deletion even when the list refresh fails', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [deletedGroup] })
      .mockRejectedValueOnce(new Error('Unable to refresh groups'));

    const { rerender } = render(<GroupSwitcher />);
    expect((await screen.findAllByText('Deleted group')).length).toBeGreaterThan(0);

    act(() => {
      window.dispatchEvent(new CustomEvent('bggg:group-deleted', { detail: { groupId: 'group-1' } }));
    });
    pathname = '/calendar';
    rerender(<GroupSwitcher />);

    await waitFor(() => expect(screen.queryByText('Deleted group')).toBeNull());
  });

  it('does not restore a deleted group from an older in-flight response', async () => {
    let resolveGroups!: (response: { ok: boolean; json: () => Promise<Group[]> }) => void;
    apiFetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveGroups = resolve;
    }));

    render(<GroupSwitcher />);
    act(() => {
      window.dispatchEvent(new CustomEvent('bggg:group-deleted', { detail: { groupId: 'group-1' } }));
    });
    await act(async () => {
      resolveGroups({ ok: true, json: async () => [deletedGroup] });
    });

    expect(screen.queryByText('Deleted group')).toBeNull();
  });
});
