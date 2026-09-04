import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Proposal, ProposalStatus } from '@/lib/types';
import type { ProposalActions } from '@/hooks/use-proposal-actions';
import { ProposalLifecycleActions } from './proposal-lifecycle-actions';

function proposal(status: ProposalStatus): Proposal {
  return {
    id: 'proposal-1',
    groupId: 'group-1',
    createdBy: 'user-1',
    proposedDate: '2026-09-03',
    hostId: null,
    status,
    confirmedStart: null,
    confirmedEnd: null,
    createdAt: '2026-09-01T12:00:00.000Z',
  };
}

function proposalActions(): ProposalActions {
  return {
    pendingAction: null,
    error: null,
    clearError: jest.fn(),
    rsvp: jest.fn<ProposalActions['rsvp']>(),
    lockIn: jest.fn<ProposalActions['lockIn']>(),
    requestConfirmation: jest.fn<ProposalActions['requestConfirmation']>(),
    finalize: jest.fn<ProposalActions['finalize']>(),
    undo: jest.fn<ProposalActions['undo']>(),
    delete: jest.fn<ProposalActions['delete']>(),
  };
}

describe('ProposalLifecycleActions', () => {
  it.each(['collecting', 'confirming', 'confirmed', 'cancelled'] as const)(
    'offers permanent deletion to managers while a proposal is %s',
    (status) => {
      render(
        <ProposalLifecycleActions
          proposal={proposal(status)}
          canManage
          actions={proposalActions()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Remove proposal' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    },
  );

  it('does not offer permanent deletion to users without management permission', () => {
    render(
      <ProposalLifecycleActions
        proposal={proposal('collecting')}
        canManage={false}
        actions={proposalActions()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Remove proposal' })).toBeNull();
  });

  it('permanently deletes the proposal only after explicit confirmation', () => {
    const actions = proposalActions();
    render(
      <ProposalLifecycleActions
        proposal={proposal('cancelled')}
        canManage
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove proposal' }));

    expect(screen.getByRole('heading', { name: 'Remove this proposal?' })).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(actions.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove proposal' }));

    expect(actions.delete).toHaveBeenCalledWith('proposal-1');
  });
});
