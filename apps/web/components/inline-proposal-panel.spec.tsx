import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AvailablePlace, ProposalGameSummary, ProposalPlaceSummary, ProposalStatus } from '@/lib/types';

let proposalStatus: ProposalStatus = 'collecting';
let proposalGames: ProposalGameSummary[] = [];
const vote = jest.fn();
const unvote = jest.fn();
const downvote = jest.fn();
const removeSuggestion = jest.fn();
let proposalPlaces: ProposalPlaceSummary[] = [];
let availablePlaces: AvailablePlace[] = [];
const downvotePlace = jest.fn();
const removePlaceSuggestion = jest.fn();

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
    rows: proposalGames,
    loading: false,
    error: null,
    pendingAction: null,
    actionError: null,
    vote,
    unvote,
    downvote,
    removeSuggestion,
  }),
}));

jest.unstable_mockModule('@/components/personal-collection', () => ({
  GameDetailsSheet: ({ game, open }: { game: { name: string } | null; open: boolean }) => open ? <div>Details for {game?.name}</div> : null,
}));

jest.unstable_mockModule('@/hooks/use-proposal-places', () => ({
  useProposalPlaces: () => ({
    rows: proposalPlaces,
    available: availablePlaces,
    loading: false,
    error: null,
    pendingAction: null,
    suggest: jest.fn(),
    vote: jest.fn(),
    downvote: downvotePlace,
    unvote: jest.fn(),
    removeSuggestion: removePlaceSuggestion,
    removeSaved: jest.fn(),
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

  it('shows proposal thumbnails, opens details, supports downvotes, and lets the suggester remove', () => {
    proposalStatus = 'collecting';
    proposalGames = [{
      proposalGameId: 'pg-1',
      game: { id: 1, bggId: 13, name: 'Catan', image: null, thumbnail: 'https://example.test/catan.jpg', minPlayers: 3, maxPlayers: 4, playingTime: 90, yearPublished: 1995, rating: 7.1 },
      voteCount: 2,
      votedByMe: false,
      downvotedByMe: false,
      proposedByMe: true,
    }];

    const { container } = render(<InlineProposalPanel proposalId="proposal-1" groups={[{ id: 'group-1', name: 'Game Night', ownerId: 'user-1', isSolo: false, createdAt: '2026-09-01T12:00:00.000Z' }]} />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/catan.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Downvote this game' }));
    expect(downvote).toHaveBeenCalledWith('pg-1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeSuggestion).toHaveBeenCalledWith('pg-1');
    fireEvent.click(screen.getByRole('button', { name: 'Catan' }));
    expect(screen.getByText('Details for Catan')).toBeTruthy();
    proposalGames = [];
  });

  it('hands confirmed proposal plays to the calendar with proposal defaults', () => {
    proposalStatus = 'confirmed';
    proposalGames = [{
      proposalGameId: 'pg-1',
      game: { id: 1, bggId: 13, name: 'Catan', image: null, thumbnail: null, minPlayers: 3, maxPlayers: 4, playingTime: 90, yearPublished: 1995, rating: 7.1 },
      voteCount: 2,
      votedByMe: false,
      downvotedByMe: false,
      proposedByMe: true,
    }];
    const onSelectPlayGame = jest.fn();
    render(<InlineProposalPanel proposalId="proposal-1" groups={[{ id: 'group-1', name: 'Game Night', ownerId: 'user-1', isSolo: false, createdAt: '2026-09-01T12:00:00.000Z' }]} onSelectPlayGame={onSelectPlayGame} />);

    fireEvent.click(screen.getByRole('button', { name: 'Log play' }));

    expect(onSelectPlayGame).toHaveBeenCalledWith(proposalGames[0].game, {
      groupId: 'group-1',
      playedDate: '2026-09-03',
      proposalId: 'proposal-1',
      userIds: ['user-1'],
    });
    proposalGames = [];
  });

  it('supports place downvotes and lets the suggester remove a place', () => {
    proposalStatus = 'collecting';
    proposalPlaces = [{
      proposalPlaceId: 'pp-1',
      place: { id: 'place-1', name: 'Clubhouse' },
      voteCount: 1,
      votedByMe: false,
      downvotedByMe: false,
      proposedByMe: true,
      ownedByMe: false,
      ownerIds: [],
    }];

    render(<InlineProposalPanel proposalId="proposal-1" groups={[{ id: 'group-1', name: 'Game Night', ownerId: 'user-1', isSolo: false, createdAt: '2026-09-01T12:00:00.000Z' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Downvote this place' }));
    expect(downvotePlace).toHaveBeenCalledWith('pp-1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removePlaceSuggestion).toHaveBeenCalledWith('pp-1');
    proposalPlaces = [];
  });

  it('adds a place to a draft before the proposal is saved', () => {
    availablePlaces = [{
      place: { id: 'place-1', name: 'Clubhouse' },
      ownedByMe: false,
      suggestionCount: 2,
    }];
    render(<InlineProposalPanel proposalId={null} draftDate="2026-09-03" groups={[{ id: 'group-1', name: 'Game Night', ownerId: 'user-1', isSolo: false, createdAt: '2026-09-01T12:00:00.000Z' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
    fireEvent.click(screen.getByRole('button', { name: /Clubhouse/ }));

    expect(screen.getByText('Clubhouse')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    availablePlaces = [];
  });
});
