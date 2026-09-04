'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';
import { useProposalActions } from '@/hooks/use-proposal-actions';
import { useGroupLibrary } from '@/hooks/use-group-library';
import { useProposalGames } from '@/hooks/use-proposal-games';
import { ProposalLifecycleActions } from '@/components/proposal-lifecycle-actions';
import { ProposalRsvpSection } from '@/components/proposal-rsvp-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { TimePickerDialog } from '@/components/ui/time-picker-dialog';
import { apiMutate } from '@/lib/api';
import { formatWindowRange } from '@/lib/datetime';
import type { Group, GroupLibraryGame, Proposal } from '@/lib/types';

function MemberName({
  userId,
  members,
  loading,
  fallbackName,
}: {
  userId: string;
  members: { id: string; displayName: string }[];
  loading: boolean;
  fallbackName?: string;
}) {
  if (loading) {
    return (
      <span
        aria-label="Loading member name"
        className="inline-block h-3 w-20 animate-pulse rounded-sm bg-border align-middle"
      />
    );
  }

  return fallbackName ?? members.find((member) => member.id === userId)?.displayName ?? 'Unknown member';
}

export interface InlineProposalPanelProps {
  /** If set, shows existing proposal details; if null, shows draft proposal creation. */
  proposalId: string | null;
  /** Required when proposalId is null (draft mode). */
  draftDate?: string;
  groups: Group[];
  defaultGroupId?: string;
  onProposalsChanged?: () => void;
  onSelectProposal?: (proposal: Proposal) => void;
}

const RSVP_ANSWERS = ['yes', 'maybe', 'no'] as const;
const STATUS_LABELS: Record<Proposal['status'], string> = {
  collecting: 'Collecting RSVPs',
  confirming: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export function InlineProposalPanel({
  proposalId,
  draftDate,
  groups,
  defaultGroupId,
  onProposalsChanged,
  onSelectProposal,
}: InlineProposalPanelProps) {
  const isDraft = proposalId === null;
  const { data: session } = useSession();
  const myId = session?.user?.id ?? null;
  const myName = session?.user?.name ?? 'You';

  // --- Existing proposal data ---
  const { detail, loading: loadingDetail, notFound, error: detailError, retry: retryDetail } =
    useProposalDetail(proposalId);
  const existingGroupId = detail?.proposal.groupId ?? null;
  const { members, loading: loadingMembers } = useGroupMembers(existingGroupId);
  const actions = useProposalActions(() => {
    retryDetail();
    onProposalsChanged?.();
  });

  // --- Draft proposal state ---
  const [selectedGroupId, setSelectedGroupId] = useState(defaultGroupId ?? '');
  const [draftStatus, setDraftStatus] = useState<'yes' | 'maybe' | 'no'>('yes');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftHoursOpen, setDraftHoursOpen] = useState(false);
  const [draftTimePickerOpen, setDraftTimePickerOpen] = useState(false);
  const [draftGames, setDraftGames] = useState<GroupLibraryGame[]>([]);
  const [draftGamePickerOpen, setDraftGamePickerOpen] = useState(false);
  const [draftGameFilter, setDraftGameFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const effectiveGroupId = isDraft
    ? (defaultGroupId || selectedGroupId || groups[0]?.id || '')
    : (existingGroupId || '');

  const activeGroup = groups.find((g) => g.id === effectiveGroupId);

  // Group Library (for game suggestions)
  const library = useGroupLibrary(effectiveGroupId || null);
  const existingGames = useProposalGames(proposalId, onProposalsChanged);

  const myRole = myId ? members.find((m) => m.id === myId)?.role : undefined;
  const canManage =
    !!detail &&
    ((myId !== null && detail.proposal.createdBy === myId) ||
      (myId !== null && activeGroup?.ownerId === myId) ||
      myRole === 'owner' ||
      myRole === 'admin');

  // Filtered games for draft game picker
  const filteredLibraryGames = useMemo(() => {
    const q = draftGameFilter.trim().toLowerCase();
    if (!q) return library.games;
    return library.games.filter((g) => g.name.toLowerCase().includes(q));
  }, [library.games, draftGameFilter]);

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveGroupId || !draftDate) return;
    if (!!draftStart !== !!draftEnd) {
      setSaveError('Please specify both start and end times, or clear both.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      // 1. Create proposal
      const res = await apiMutate(`/groups/${effectiveGroupId}/proposals`, 'POST', {
        proposedDate: draftDate,
      });
      const created = (await res.json()) as Proposal;

      // 2. If non-default RSVP or custom hours, update RSVP
      if (draftStatus !== 'yes' || (draftStart && draftEnd)) {
        await apiMutate(`/proposals/${created.id}/rsvp`, 'PUT', {
          status: draftStatus,
          ...(draftStart && draftEnd ? { availableStart: draftStart, availableEnd: draftEnd } : {}),
        });
      }

      // 3. If draft games were added, propose each
      for (const game of draftGames) {
        await apiMutate(`/proposals/${created.id}/games`, 'POST', {
          gameId: game.id,
        });
      }

      onProposalsChanged?.();
      onSelectProposal?.(created);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not create proposal');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-raised p-4 font-body text-sm shadow-sm transition-all">
      {/* 1. Header Bar */}
      <div className="flex items-center justify-between border-b border-border pb-3 mb-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {isDraft ? (
            !defaultGroupId ? (
              <label className="flex items-center gap-1.5 font-medium text-text">
                <span>Group:</span>
                <select
                  value={effectiveGroupId}
                  onChange={(e) => {
                    setSelectedGroupId(e.target.value);
                    setDraftGames([]);
                  }}
                  disabled={saving || groups.length === 0}
                  className="rounded border border-border bg-surface px-2 py-0.5 text-xs font-normal text-text focus:outline-none"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.isSolo ? `${g.name} (solo)` : g.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>
                Group: <strong className="font-medium text-text">{activeGroup ? (activeGroup.isSolo ? `${activeGroup.name} (solo)` : activeGroup.name) : 'This group'}</strong>
              </span>
            )
          ) : (
            detail && (
              <span>
                {activeGroup && <>Group: <strong className="font-medium text-text">{activeGroup.isSolo ? `${activeGroup.name} (solo)` : activeGroup.name}</strong> · </>}
                Status: <Badge>{STATUS_LABELS[detail.proposal.status]}</Badge>
                {' · '}Proposed by:{' '}
                <strong className="font-medium text-text">
                  <MemberName
                    userId={detail.proposal.createdBy}
                    members={members}
                    loading={loadingMembers}
                    fallbackName={detail.proposal.createdBy === myId ? myName : undefined}
                  />
                </strong>
                {detail.proposal.hostId && (
                  <>
                    {' · '}Host:{' '}
                    <strong className="font-medium text-text">
                      <MemberName
                        userId={detail.proposal.hostId}
                        members={members}
                        loading={loadingMembers}
                        fallbackName={detail.proposal.hostId === myId ? myName : undefined}
                      />
                    </strong>
                  </>
                )}
              </span>
            )
          )}
        </div>

      </div>

      {/* Loading / Error States for Existing Proposal */}
      {!isDraft && loadingDetail && <p className="text-text-muted">Loading proposal details…</p>}
      {!isDraft && notFound && <p className="text-accent">This item is no longer available.</p>}
      {!isDraft && detailError && (
        <p className="text-accent">
          {detailError}{' '}
          <button type="button" onClick={retryDetail} className="underline">
            Retry
          </button>
        </p>
      )}

      {/* 2. RSVP Section */}
      {isDraft ? (
        <div className="space-y-3">
          <div>
            <div className="font-medium text-sm">Your answer</div>
            <div className="mt-2 flex gap-2">
              {RSVP_ANSWERS.map((answer) => (
                <Button
                  key={answer}
                  type="button"
                  variant={draftStatus === answer ? 'primary' : 'secondary'}
                  disabled={saving}
                  onClick={() => setDraftStatus(answer)}
                >
                  {answer[0].toUpperCase() + answer.slice(1)}
                </Button>
              ))}
            </div>

            {draftStatus !== 'no' && (
              <div className="mt-2">
                <button
                  type="button"
                  className="text-xs text-text-muted underline"
                  onClick={() => setDraftHoursOpen((o) => !o)}
                >
                  {draftHoursOpen ? 'Hide hours' : 'Specify hours'}
                </button>
                {draftHoursOpen && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setDraftTimePickerOpen(true)}
                      className="rounded border border-border bg-surface px-2 py-1 text-xs hover:border-text-muted"
                      aria-label="Available from"
                    >
                      {draftStart || 'Start time'}
                    </button>
                    <span>–</span>
                    <button
                      type="button"
                      onClick={() => setDraftTimePickerOpen(true)}
                      className="rounded border border-border bg-surface px-2 py-1 text-xs hover:border-text-muted"
                      aria-label="Available until"
                    >
                      {draftEnd || 'End time'}
                    </button>
                    {(draftStart || draftEnd) && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftStart('');
                          setDraftEnd('');
                        }}
                        className="text-xs text-text-muted underline"
                      >
                        Clear
                      </button>
                    )}
                    <span className="text-xs text-text-muted">(times in UTC)</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="font-medium text-xs uppercase tracking-wider text-text-muted mb-1">RSVPs</div>
            <ul className="space-y-1">
              <li className="flex items-center gap-2 text-xs">
                <span>
                  {myName} — {draftStatus}
                  {draftStart && draftEnd && <span className="text-text-muted"> · {draftStart} – {draftEnd} (UTC)</span>}
                </span>
                <Badge>Host</Badge>
              </li>
            </ul>
          </div>
        </div>
      ) : (
        detail && (
          <div className="space-y-3">
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
                      <span>
                        <MemberName
                          userId={rsvp.userId}
                          members={members}
                          loading={loadingMembers}
                          fallbackName={rsvp.userId === myId ? myName : undefined}
                        />{' '}
                        — {rsvp.status}
                        {formatWindowRange(rsvp.availableStart, rsvp.availableEnd) && (
                          <span className="text-text-muted"> · {formatWindowRange(rsvp.availableStart, rsvp.availableEnd)}</span>
                        )}
                      </span>
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
          </div>
        )
      )}

      {/* 3. Suggested Games Section */}
      <div className="border-t border-border pt-3 mt-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Suggested games</div>
          {isDraft || (detail && detail.proposal.status === 'collecting') ? (
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              disabled={isDraft ? saving : existingGames.pendingAction !== null}
              onClick={() => setDraftGamePickerOpen(true)}
            >
              Add game
            </Button>
          ) : null}
        </div>

        {isDraft ? (
          draftGames.length === 0 ? (
            <p className="mt-2 text-text-muted">No games suggested yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {draftGames.map((game) => (
                <li key={game.id} className="flex items-center justify-between text-xs">
                  <span>
                    {game.name}{' '}
                    <span className="text-text-muted">({game.minPlayers}–{game.maxPlayers} players)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDraftGames((prev) => prev.filter((g) => g.id !== game.id))}
                    className="text-xs text-text-muted hover:text-accent"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          detail && (
            <ul className="mt-2 flex flex-col gap-1">
              {existingGames.loading && <p className="text-text-muted">Loading games…</p>}
              {existingGames.rows.map(({ proposalGameId, game, voteCount, votedByMe }) => (
                <li key={proposalGameId} className="flex items-center gap-2 text-xs">
                  {detail.proposal.status === 'collecting' && (
                    <button
                      type="button"
                      aria-label={votedByMe ? 'Remove your vote' : 'Vote for this game'}
                      className={`text-lg leading-none ${votedByMe ? 'text-accent' : 'text-text-muted'}`}
                      disabled={existingGames.pendingAction !== null}
                      onClick={() => void (votedByMe ? existingGames.unvote(proposalGameId) : existingGames.vote(proposalGameId))}
                    >
                      ▲
                    </button>
                  )}
                  <span>{game.name}</span>
                  <Badge>
                    {voteCount} vote{voteCount === 1 ? '' : 's'}
                  </Badge>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* 4. Footer Actions */}
      {isDraft ? (
        <div className="border-t border-border pt-3 mt-3">
          {saveError && <p className="text-xs text-accent mb-2">{saveError}</p>}
          <Button
            type="button"
            disabled={saving || !effectiveGroupId}
            onClick={handleSaveDraft}
          >
            {saving ? 'Saving…' : 'Save proposal'}
          </Button>
        </div>
      ) : (
        detail && (
          <div className="border-t border-border pt-3 mt-3">
            {actions.error && <p className="mb-2 text-xs text-accent" role="alert">{actions.error}</p>}
            <ProposalLifecycleActions proposal={detail.proposal} canManage={canManage} actions={actions} />
          </div>
        )
      )}

      {/* Time Picker Dialog (Draft Mode) */}
      <TimePickerDialog
        open={draftTimePickerOpen}
        startValue={draftStart}
        endValue={draftEnd}
        title="Choose availability"
        onOpenChange={setDraftTimePickerOpen}
        onConfirm={(start, end) => {
          setDraftStart(start);
          setDraftEnd(end);
          setDraftTimePickerOpen(false);
        }}
      />

      {/* Add Game Picker Dialog (Shared for both Draft and Existing) */}
      <Dialog open={draftGamePickerOpen} onOpenChange={setDraftGamePickerOpen}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Pick a game</DialogTitle>
          <DialogClose className="mb-2 mt-1 block text-sm text-text-muted">Close ✕</DialogClose>

          <input
            type="search"
            placeholder="Filter by name…"
            value={draftGameFilter}
            onChange={(e) => setDraftGameFilter(e.target.value)}
            className="mb-2 w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm"
          />

          {library.loading && <p className="text-sm text-text-muted">Loading library…</p>}
          {library.error && <p className="text-sm text-accent">{library.error}</p>}
          {!library.loading && !library.error && filteredLibraryGames.length === 0 && (
            <p className="text-sm text-text-muted">Nothing matches — the library comes from members&apos; imported BGG collections.</p>
          )}

          <ul className="flex flex-col gap-1">
            {filteredLibraryGames.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="block w-full rounded-sm bg-surface px-2 py-1 text-left text-sm hover:bg-surface-raised"
                  onClick={() => {
                    if (isDraft) {
                      if (!draftGames.some((existing) => existing.id === g.id)) {
                        setDraftGames((prev) => [...prev, g]);
                      }
                    } else if (proposalId) {
                      void existingGames.proposeGame(g.id);
                    }
                    setDraftGamePickerOpen(false);
                    setDraftGameFilter('');
                  }}
                >
                  {g.name}
                  <span className="ml-2 text-xs text-text-muted">
                    {g.minPlayers}–{g.maxPlayers} players
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
