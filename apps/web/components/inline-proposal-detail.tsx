'use client';

import { useSession } from 'next-auth/react';
import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';
import { useProposalActions } from '@/hooks/use-proposal-actions';
import { ProposalLifecycleActions } from '@/components/proposal-lifecycle-actions';
import { ProposalRsvpSection } from '@/components/proposal-rsvp-section';
import { ProposalGamesSection } from '@/components/proposal-games-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface InlineProposalDetailProps {
  proposalId: string;
  onClose: () => void;
  /** Called after any successful mutation — parents refresh their lists here. */
  onChanged?: () => void;
}

export function InlineProposalDetail({ proposalId, onClose, onChanged }: InlineProposalDetailProps) {
  const { detail, loading, notFound, error, retry } = useProposalDetail(proposalId);
  const members = useGroupMembers(detail?.proposal.groupId ?? null);
  const { data: session } = useSession();

  const actions = useProposalActions(() => {
    retry();
    onChanged?.();
  });

  const myId = session?.user?.id ?? null;
  const myRole = myId ? members.find((m) => m.id === myId)?.role : undefined;
  const canManage =
    !!detail &&
    ((myId !== null && detail.proposal.createdBy === myId) ||
      myRole === 'owner' ||
      myRole === 'admin');

  function nameFor(userId: string): string {
    return members.find((m) => m.id === userId)?.displayName ?? userId;
  }

  return (
    <div className="rounded-md border border-border bg-surface-raised p-4 font-body text-sm shadow-sm transition-all">
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
        <h3 className="font-display text-base font-semibold">Proposal Overview</h3>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          className="h-6 w-6 p-0 text-text-muted hover:text-text"
          aria-label="Close overview"
        >
          ✕
        </Button>
      </div>

      {loading && <p className="text-text-muted">Loading proposal details…</p>}
      {notFound && <p className="text-accent">This item is no longer available.</p>}
      {error && (
        <p className="text-accent">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}

      {actions.error && <p className="text-accent">{actions.error}</p>}

      {detail && detail.proposal.status === 'cancelled' ? (
        <p className="rounded-sm bg-surface p-3 text-sm text-text-muted">
          This proposal was cancelled.
        </p>
      ) : (
        detail && (
          <div className="space-y-4">
            <div>
              <div className="font-display text-base font-medium">{detail.proposal.proposedDate}</div>
              <div className="text-xs text-text-muted">Status: {detail.proposal.status}</div>
              <div className="text-xs text-text-muted">Proposed by: {nameFor(detail.proposal.createdBy)}</div>
              {detail.proposal.hostId && (
                <div className="text-xs text-text-muted">Host: {nameFor(detail.proposal.hostId)}</div>
              )}
            </div>

            <ProposalRsvpSection
              proposalId={detail.proposal.id}
              proposalStatus={detail.proposal.status}
              myRsvp={detail.rsvps.find((r) => r.userId === myId)}
              actions={actions}
            />

            <div>
              <div className="font-medium text-xs uppercase tracking-wider text-text-muted mb-1">RSVPs</div>
              <ul className="space-y-1">
                {detail.rsvps.map((rsvp) => {
                  const isHost = detail.proposal.hostId === rsvp.userId;
                  const canMakeHost =
                    canManage &&
                    detail.proposal.status !== 'cancelled' &&
                    rsvp.status === 'yes';
                  return (
                    <li key={rsvp.userId} className="flex items-center gap-2 text-xs">
                      <span>{nameFor(rsvp.userId)} — {rsvp.status}</span>
                      {isHost && <Badge>Host</Badge>}
                      {canManage && rsvp.confirmed && <Badge>Locked in</Badge>}
                      {canMakeHost && !isHost && (
                        <button
                          type="button"
                          className="text-text-muted underline hover:text-text"
                          disabled={actions.pendingAction !== null}
                          onClick={() => void actions.setHost(detail.proposal.id, rsvp.userId)}
                        >
                          Make host
                        </button>
                      )}
                      {canManage && isHost && detail.proposal.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="text-text-muted underline hover:text-text"
                          disabled={actions.pendingAction !== null}
                          onClick={() => void actions.clearHost(detail.proposal.id)}
                        >
                          Clear host
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <ProposalGamesSection
              proposalId={detail.proposal.id}
              groupId={detail.proposal.groupId}
              proposalStatus={detail.proposal.status}
              onChanged={onChanged}
            />

            <ProposalLifecycleActions proposal={detail.proposal} canManage={canManage} actions={actions} />
          </div>
        )
      )}
    </div>
  );
}
