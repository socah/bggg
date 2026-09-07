import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ProposalStatus } from '@/lib/types';

let proposalStatus: ProposalStatus = 'collecting';

jest.unstable_mockModule('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', name: 'Alice', username: 'alice' } } }),
  getSession: jest.fn(),
  signOut: jest.fn(),
}));

jest.unstable_mockModule('@/hooks/use-proposal-detail', () => ({
  useProposalDetail: () => ({
    detail: {
      proposal: {
        id: 'proposal-1',
        groupId: 'group-1',
        createdBy: 'user-1',
        proposedDate: '2026-09-03',
        hostId: null,
        status: proposalStatus,
        confirmedStart: null,
        confirmedEnd: null,
        createdAt: '2026-09-03T12:00:00.000Z',
      },
      rsvps: [
        {
          id: 1,
          proposalId: 'proposal-1',
          userId: 'user-1',
          status: 'yes',
          availableStart: null,
          availableEnd: null,
          confirmed: false,
        },
      ],
      games: [],
      places: [],
      canManage: false,
    },
    loading: false,
    notFound: false,
    error: null,
    retry: jest.fn(),
  }),
}));

jest.unstable_mockModule('@/hooks/use-group-members', () => ({
  useGroupMembers: () => ({ members: [{ id: 'user-1', username: 'alice', displayName: 'Alice', role: 'owner' }], loading: false, reload: jest.fn() }),
}));

jest.unstable_mockModule('@/hooks/use-proposal-actions', () => ({
  useProposalActions: () => ({ pendingAction: null, error: null }),
}));

jest.unstable_mockModule('@/hooks/use-group-library', () => ({
  useGroupLibrary: () => ({ games: [], loading: false, error: null, reload: jest.fn() }),
}));

jest.unstable_mockModule('@/hooks/use-proposal-games', () => ({
  useProposalGames: () => ({
    rows: [],
    loading: false,
    error: null,
    pendingAction: null,
    actionError: null,
  }),
}));

jest.unstable_mockModule('@/hooks/use-proposal-places', () => ({
  useProposalPlaces: () => ({
    rows: [],
    available: [],
    loading: false,
    error: null,
    pendingAction: null,
    suggest: jest.fn(),
    vote: jest.fn(),
    unvote: jest.fn(),
    setOwned: jest.fn(),
  }),
}));

jest.unstable_mockModule('@/components/proposal-lifecycle-actions', () => ({
  ProposalLifecycleActions: () => null,
}));

jest.unstable_mockModule('@/components/proposal-rsvp-section', () => ({
  ProposalRsvpSection: () => null,
}));

const { InlineProposalPanel } = await import('./inline-proposal-panel');

describe('InlineProposalPanel', () => {
  it.each([
    ['collecting', 'Collecting RSVPs'],
    ['confirming', 'Awaiting confirmation'],
    ['confirmed', 'Confirmed'],
    ['cancelled', 'Cancelled'],
  ] as const)('shows the %s status as the "%s" badge', (status, label) => {
    proposalStatus = status;

    render(
      <InlineProposalPanel
        proposalId="proposal-1"
        groups={[
          {
            id: 'group-1',
            name: 'Game Night',
            ownerId: 'user-1',
            isSolo: false,
            createdAt: '2026-09-01T12:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByText(label).className).toMatch(/bg-(amber|sky|emerald|slate)-/);
  });

  it('uses the linked username for the current user', () => {
    proposalStatus = 'collecting';
    render(
      <InlineProposalPanel
        proposalId="proposal-1"
        groups={[
          {
            id: 'group-1',
            name: 'Game Night',
            ownerId: 'user-1',
            isSolo: false,
            createdAt: '2026-09-01T12:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getAllByRole('link', { name: 'alice' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'alice' })[0].getAttribute('href')).toBe('/groups/group-1/collection/user-1');
    expect(screen.getByText(/— yes/)).toBeTruthy();
    expect(screen.queryByText('Unknown member')).toBeNull();
  });
});
