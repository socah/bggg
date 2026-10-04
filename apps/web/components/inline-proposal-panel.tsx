'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';
import { useProposalActions } from '@/hooks/use-proposal-actions';
import { useGroupLibrary } from '@/hooks/use-group-library';
import { useProposalGames } from '@/hooks/use-proposal-games';
import { useProposalPlaces } from '@/hooks/use-proposal-places';
import { ProposalLifecycleActions } from '@/components/proposal-lifecycle-actions';
import { ProposalStatusBadge } from '@/components/proposal-status-badge';
import { ProposalRsvpSection } from '@/components/proposal-rsvp-section';
import { UserIdentityLink } from '@/components/user-identity-link';
import { ProposalChat } from '@/components/proposal-chat';
import { GameDetailsSheet } from '@/components/personal-collection';
import { PlayLogDialog, type PlayLogDefaults } from '@/components/play-log-dialog';
import { GamePickerDialog } from '@/components/game-picker-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { TimePickerDialog } from '@/components/ui/time-picker-dialog';
import { apiMutate } from '@/lib/api';
import { formatWindowRange } from '@/lib/datetime';
import { groupUsername } from '@/lib/user-identity';
import type { AvailablePlace, GameCardGame, Group, GroupLibraryGame, GroupMemberInfo, Proposal } from '@/lib/types';

type DraftPlace = Pick<AvailablePlace, 'place' | 'ownedByMe'> & {
  input: { placeId: string } | { name: string };
};

function MemberName({
  userId,
  members,
  loading,
  groupId,
  fallbackName,
}: {
  userId: string;
  members: GroupMemberInfo[];
  loading: boolean;
  groupId: string;
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

  const member = members.find((candidate) => candidate.id === userId);
  if (member) return <UserIdentityLink user={member} groupId={groupId} />;
  return fallbackName ?? 'Unknown member';
}

export interface InlineProposalPanelProps {
  /** If set, shows existing proposal details; if null, shows draft proposal creation. */
  proposalId: string | null;
  /** Required when proposalId is null (draft mode). */
  draftDate?: string;
  groups: Group[];
  defaultGroupId?: string;
  onProposalsChanged?: () => void;
  onPlayLogged?: () => void;
  onSelectPlayGame?: (game: GameCardGame, defaults: PlayLogDefaults) => void;
  onSelectProposal?: (proposal: Proposal) => void;
  embedded?: boolean;
}

const RSVP_ANSWERS = ['yes', 'maybe', 'no'] as const;
export function InlineProposalPanel({
  proposalId,
  draftDate,
  groups,
  defaultGroupId,
  onProposalsChanged,
  onPlayLogged,
  onSelectPlayGame,
  onSelectProposal,
  embedded = false,
}: InlineProposalPanelProps) {
  const isDraft = proposalId === null;
  const { data: session } = useSession();
  const myId = session?.user?.id ?? null;
  const sessionName = session?.user?.username ?? session?.user?.name ?? 'You';

  // --- Draft proposal state ---
  const [selectedGroupId, setSelectedGroupId] = useState(defaultGroupId ?? '');

  // --- Existing proposal data ---
  const { detail, loading: loadingDetail, notFound, error: detailError, retry: retryDetail } =
    useProposalDetail(proposalId);
  const existingGroupId = detail?.proposal.groupId ?? null;
  const memberGroupId = (existingGroupId ?? defaultGroupId ?? selectedGroupId) || null;
  const { members, loading: loadingMembers } = useGroupMembers(memberGroupId);
  const myMember = members.find((member) => member.id === myId);
  const myName = myMember ? groupUsername(myMember) : sessionName;
  const actions = useProposalActions(() => {
    retryDetail();
    onProposalsChanged?.();
  });

  const [draftStatus, setDraftStatus] = useState<'yes' | 'maybe' | 'no'>('yes');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftHoursOpen, setDraftHoursOpen] = useState(false);
  const [draftTimePickerOpen, setDraftTimePickerOpen] = useState(false);
  const [draftGames, setDraftGames] = useState<GroupLibraryGame[]>([]);
  const [draftPlaces, setDraftPlaces] = useState<DraftPlace[]>([]);
  const [draftGamePickerOpen, setDraftGamePickerOpen] = useState(false);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [placeFilter, setPlaceFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameCardGame | null>(null);
  const [playGame, setPlayGame] = useState<GameCardGame | null>(null);
  const [settingPlaceId, setSettingPlaceId] = useState<string | null>(null);
  const [placeSelectionError, setPlaceSelectionError] = useState<string | null>(null);

  const effectiveGroupId = isDraft
    ? (defaultGroupId || selectedGroupId || groups[0]?.id || '')
    : (existingGroupId || '');

  const activeGroup = groups.find((g) => g.id === effectiveGroupId);

  // Group Library (for game suggestions)
  const library = useGroupLibrary(effectiveGroupId || null);
  const existingGames = useProposalGames(proposalId, onProposalsChanged);
  const existingPlaces = useProposalPlaces(proposalId, onProposalsChanged);

  const canManage = detail?.canManage ?? false;

  async function setSessionPlace(placeId: string) {
    if (!detail?.session) return;
    setSettingPlaceId(placeId);
    setPlaceSelectionError(null);
    try {
      await apiMutate(`/groups/${detail.proposal.groupId}/sessions/${detail.session.id}/place`, 'PATCH', { placeId });
      retryDetail();
      onProposalsChanged?.();
    } catch (reason) {
      setPlaceSelectionError(reason instanceof Error ? reason.message : 'Could not set session place');
    } finally {
      setSettingPlaceId(null);
    }
  }

  const gameRowRefs = useRef(new Map<string, HTMLLIElement>());
  const previousGamePositions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    for (const [id, element] of gameRowRefs.current) {
      const top = element.getBoundingClientRect().top;
      nextPositions.set(id, top);
      const previousTop = previousGamePositions.current.get(id);
      if (previousTop !== undefined && previousTop !== top) {
        element.animate(
          [{ transform: `translateY(${previousTop - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    }
    previousGamePositions.current = nextPositions;
  }, [existingGames.rows]);

  const filteredPlaces = useMemo(() => {
    const suggestedIds = new Set(
      isDraft ? draftPlaces.map((row) => row.place.id) : existingPlaces.rows.map((row) => row.place.id),
    );
    const query = placeFilter.trim().toLowerCase();
    return existingPlaces.available.filter(
      ({ place }) => !suggestedIds.has(place.id) && place.name.toLowerCase().includes(query),
    );
  }, [draftPlaces, existingPlaces.available, existingPlaces.rows, isDraft, placeFilter]);

  const placeNameExists = existingPlaces.available.some(
    ({ place }) => place.name.toLowerCase() === placeFilter.trim().toLowerCase(),
  ) || draftPlaces.some(({ place }) => place.name.toLowerCase() === placeFilter.trim().toLowerCase());

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

      for (const place of draftPlaces) {
        await apiMutate(`/proposals/${created.id}/places`, 'POST', place.input);
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
    <div className={`${embedded ? '' : 'rounded-md border border-border shadow-sm'} bg-surface-raised p-4 font-body text-sm transition-all`}>
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
                    setDraftPlaces([]);
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
                Status: <ProposalStatusBadge status={detail.proposal.status} />
                {' · '}Proposed by:{' '}
                <strong className="font-medium text-text">
                  <MemberName
                    userId={detail.proposal.createdBy}
                    members={members}
                    loading={loadingMembers}
                    groupId={effectiveGroupId}
                    fallbackName={detail.proposal.createdBy === myId ? myName : undefined}
                  />
                </strong>
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

      <div className={!isDraft && detail ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]' : undefined}>
      <div className="min-w-0">
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
            <div className="mb-1 text-xs font-medium tracking-wider text-text-muted">RSVPs</div>
            <ul className="space-y-1">
              <li className="flex items-center gap-2 text-xs">
                <span>
                  {myName} — {draftStatus}
                  {draftStart && draftEnd && <span className="text-text-muted"> · {draftStart} – {draftEnd} (UTC)</span>}
                </span>
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
              <div className="mb-1 text-xs font-medium tracking-wider text-text-muted">RSVPs</div>
              <ul className="space-y-1">
                {detail.rsvps.map((rsvp) => {
                  return (
                    <li key={rsvp.userId} className="flex items-center gap-2 text-xs">
                      <span>
                        <MemberName
                          userId={rsvp.userId}
                          members={members}
                          loading={loadingMembers}
                          groupId={effectiveGroupId}
                          fallbackName={rsvp.userId === myId ? myName : undefined}
                        />{' '}
                        — {rsvp.status}
                        {formatWindowRange(rsvp.availableStart, rsvp.availableEnd) && (
                          <span className="text-text-muted"> · {formatWindowRange(rsvp.availableStart, rsvp.availableEnd)}</span>
                        )}
                      </span>
                      {canManage && rsvp.confirmed && <Badge>Locked in</Badge>}
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
                <li key={game.id} className="flex items-center justify-between gap-3 text-xs">
                  <button type="button" onClick={() => setSelectedGame(game)} className="flex min-w-0 items-center gap-2 text-left">
                    {game.thumbnail || game.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={game.thumbnail || game.image || ''} alt="" className="size-10 shrink-0 rounded-sm object-cover" />
                    ) : <span className="size-10 shrink-0 rounded-sm bg-surface" />}
                    <span>{game.name} <span className="text-text-muted">({game.minPlayers}–{game.maxPlayers} players)</span></span>
                  </button>
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
              {existingGames.rows.map(({ proposalGameId, game, voteCount, votedByMe, downvotedByMe, proposedByMe }) => (
                <li
                  key={proposalGameId}
                  ref={(element) => {
                    if (element) gameRowRefs.current.set(proposalGameId, element);
                    else gameRowRefs.current.delete(proposalGameId);
                  }}
                  className="flex items-center gap-3 rounded-sm border border-border bg-surface px-3 py-2 text-sm"
                >
                  {detail.proposal.status === 'collecting' && (
                    <div className="flex shrink-0 items-center overflow-hidden rounded-full border border-border-strong">
                      <button type="button" aria-label={votedByMe ? 'Remove your upvote' : 'Upvote this game'} className={`px-2 py-1 font-semibold ${votedByMe ? 'bg-accent text-accent-ink' : 'bg-surface-raised hover:bg-highlight'}`} disabled={existingGames.pendingAction !== null} onClick={() => void (votedByMe ? existingGames.unvote(proposalGameId) : existingGames.vote(proposalGameId))}>▲</button>
                      <span className="min-w-8 px-1 text-center font-semibold">{voteCount}</span>
                      <button type="button" aria-label={downvotedByMe ? 'Remove your downvote' : 'Downvote this game'} className={`px-2 py-1 font-semibold ${downvotedByMe ? 'bg-accent text-accent-ink' : 'bg-surface-raised hover:bg-highlight'}`} disabled={existingGames.pendingAction !== null} onClick={() => void (downvotedByMe ? existingGames.unvote(proposalGameId) : existingGames.downvote(proposalGameId))}>▼</button>
                    </div>
                  )}
                  {detail.proposal.status !== 'collecting' && (
                    <span className="inline-flex min-w-12 items-center justify-center gap-1 rounded-full bg-highlight px-2 py-1 font-semibold text-text">
                      <span aria-hidden="true">▲</span>
                      <span>{voteCount}</span>
                    </span>
                  )}
                   <button type="button" onClick={() => setSelectedGame(game)} className="flex min-w-0 flex-1 items-center gap-3 text-left font-medium">
                    {game.thumbnail || game.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={game.thumbnail || game.image || ''} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
                    ) : <span className="size-12 shrink-0 rounded-sm bg-surface-raised" />}
                    <span className="truncate underline-offset-2 hover:underline">{game.name}</span>
                   </button>
                   {detail.proposal.status === 'confirmed' && <Button type="button" variant="secondary" className="min-h-9 shrink-0 px-3 text-xs" onClick={() => {
                     const defaults = {
                       groupId: detail.proposal.groupId,
                       playedDate: detail.proposal.proposedDate,
                       proposalId: detail.proposal.id,
                       userIds: detail.rsvps.filter((rsvp) => rsvp.status !== 'no').map((rsvp) => rsvp.userId),
                     };
                     if (onSelectPlayGame) onSelectPlayGame(game, defaults);
                     else setPlayGame(game);
                   }}>Log play</Button>}
                   {detail.proposal.status === 'collecting' && proposedByMe && <button type="button" className="ml-auto text-xs text-text-muted underline hover:text-accent" disabled={existingGames.pendingAction !== null} onClick={() => void existingGames.removeSuggestion(proposalGameId)}>Remove</button>}
                </li>
              ))}
            </ul>
          )
        )}
        {existingGames.actionError && <p role="alert" className="mt-2 text-xs text-accent">{existingGames.actionError}</p>}
      </div>

      {/* 4. Suggested Places Section */}
      {(isDraft || detail) && (
        <div className="border-t border-border pt-3 mt-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">Suggested places</div>
            {(isDraft || detail?.proposal.status === 'collecting') && (
              <Button type="button" variant="secondary" className="px-2 py-1 text-xs" disabled={isDraft ? saving : existingPlaces.pendingAction !== null} onClick={() => setPlacePickerOpen(true)}>
                Add place
              </Button>
            )}
          </div>

          {existingPlaces.loading && <p className="mt-2 text-text-muted">Loading places...</p>}
          {existingPlaces.error && <p className="mt-2 text-accent" role="alert">{existingPlaces.error}</p>}
          {!existingPlaces.loading && (isDraft ? draftPlaces.length === 0 : existingPlaces.rows.length === 0) && (
            <p className="mt-2 text-text-muted">No places suggested yet.</p>
          )}
          {isDraft ? (
            <ul className="mt-2 flex flex-col gap-1">
              {draftPlaces.map((row) => (
                <li key={row.place.id} className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-2 text-sm">
                  <span className="font-medium">{row.place.name}</span>
                  <button type="button" className="text-xs text-text-muted underline hover:text-accent" onClick={() => setDraftPlaces((places) => places.filter((place) => place.place.id !== row.place.id))}>Remove</button>
                </li>
              ))}
            </ul>
          ) : detail ? (
            <ul className="mt-2 flex flex-col gap-1">
              {existingPlaces.rows.map((row) => (
                <li key={row.proposalPlaceId} className="rounded-sm border border-border bg-surface px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    {detail.proposal.status === 'collecting' ? (
                      <div className="flex shrink-0 items-center overflow-hidden rounded-full border border-border-strong">
                        <button type="button" aria-label={row.votedByMe ? 'Remove your upvote' : 'Upvote this place'} className={`px-2 py-1 font-semibold ${row.votedByMe ? 'bg-accent text-accent-ink' : 'bg-surface-raised hover:bg-highlight'}`} disabled={existingPlaces.pendingAction !== null} onClick={() => void (row.votedByMe ? existingPlaces.unvote(row.proposalPlaceId) : existingPlaces.vote(row.proposalPlaceId))}>▲</button>
                        <span className="min-w-8 px-1 text-center font-semibold">{row.voteCount}</span>
                        <button type="button" aria-label={row.downvotedByMe ? 'Remove your downvote' : 'Downvote this place'} className={`px-2 py-1 font-semibold ${row.downvotedByMe ? 'bg-accent text-accent-ink' : 'bg-surface-raised hover:bg-highlight'}`} disabled={existingPlaces.pendingAction !== null} onClick={() => void (row.downvotedByMe ? existingPlaces.unvote(row.proposalPlaceId) : existingPlaces.downvote(row.proposalPlaceId))}>▼</button>
                      </div>
                    ) : (
                      <span className="inline-flex min-w-12 items-center justify-center gap-1 rounded-full bg-highlight px-2 py-1 font-semibold text-text"><span aria-hidden="true">▲</span><span>{row.voteCount}</span></span>
                    )}
                    <span className="font-medium">{row.place.name}</span>
                    {detail.proposal.status === 'confirmed' && detail.session && canManage && <Button type="button" variant="secondary" className="ml-auto min-h-8 px-2 text-xs" disabled={settingPlaceId !== null || detail.session.place?.id === row.place.id} onClick={() => void setSessionPlace(row.place.id)}>{detail.session.place?.id === row.place.id ? 'Session place' : settingPlaceId === row.place.id ? 'Setting...' : 'Set as session place'}</Button>}
                    {row.ownerIds.length > 0 && (
                      <span className="text-xs text-text-muted">
                        Hosted by{' '}
                        {row.ownerIds.map((ownerId, index) => (
                          <span key={ownerId}>{index > 0 && ', '}<MemberName userId={ownerId} members={members} loading={loadingMembers} groupId={effectiveGroupId} fallbackName={ownerId === myId ? myName : undefined} /></span>
                        ))}
                      </span>
                    )}
                    {detail.proposal.status === 'collecting' && (
                      <div className="ml-auto flex items-center gap-3">
                        <button type="button" className="text-xs text-text-muted underline hover:text-text" disabled={existingPlaces.pendingAction !== null} onClick={() => void existingPlaces.setOwned(row.proposalPlaceId, !row.ownedByMe)}>{row.ownedByMe ? 'This is no longer my place' : 'This is my place'}</button>
                        {row.proposedByMe && <button type="button" className="text-xs text-text-muted underline hover:text-accent" disabled={existingPlaces.pendingAction !== null} onClick={() => void existingPlaces.removeSuggestion(row.proposalPlaceId)}>Remove</button>}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {placeSelectionError && <p role="alert" className="mt-2 text-xs text-accent">{placeSelectionError}</p>}
        </div>
      )}

      {/* 5. Footer Actions */}
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
            <ProposalLifecycleActions
              proposal={detail.proposal}
              canManage={canManage}
              actions={actions}
              soleAttendee={detail.rsvps.filter((rsvp) => rsvp.status !== 'no').length === 1}
            />
          </div>
        )
      )}
      </div>

      {!isDraft && detail && (
        <aside className="min-w-0 lg:border-l lg:border-border lg:pl-4">
          <ProposalChat
            groupId={detail.proposal.groupId}
            proposalId={detail.proposal.id}
            members={members}
            openOnDesktop
          />
        </aside>
      )}
      </div>

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

      <GamePickerDialog
        open={draftGamePickerOpen}
        title="Add suggested games"
        games={library.games}
        addedIds={new Set(isDraft ? draftGames.map((game) => game.id) : existingGames.rows.map((row) => row.game.id))}
        loading={library.loading}
        error={library.error}
        onOpenChange={setDraftGamePickerOpen}
        onAdd={async (game) => {
          if (isDraft) {
            setDraftGames((current) => current.some((candidate) => candidate.id === game.id) ? current : [...current, game]);
            return true;
          }
          return proposalId ? existingGames.proposeGame(game.id) : false;
        }}
      />

      <Dialog open={placePickerOpen} onOpenChange={setPlacePickerOpen}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Suggest a place</DialogTitle>
          <DialogClose className="mb-2 mt-1 block text-sm text-text-muted">Close ✕</DialogClose>
          <input
            type="search"
            placeholder="Filter or enter a new place..."
            value={placeFilter}
            onChange={(event) => setPlaceFilter(event.target.value)}
            className="mb-2 w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm"
          />
          {filteredPlaces.length === 0 && !placeFilter.trim() && (
            <p className="text-sm text-text-muted">No places available yet. Enter a name to add one.</p>
          )}
          <ul className="flex flex-col gap-1">
            {filteredPlaces.map(({ place, ownedByMe, suggestionCount }) => (
              <li key={place.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="block min-w-0 flex-1 rounded-sm bg-surface px-2 py-1 text-left text-sm hover:bg-surface-raised"
                  onClick={() => {
                    if (isDraft) {
                      setDraftPlaces((rows) => [...rows, { place, ownedByMe, input: { placeId: place.id } }]);
                    } else {
                      void existingPlaces.suggest({ placeId: place.id });
                    }
                    setPlacePickerOpen(false);
                    setPlaceFilter('');
                  }}
                >
                  {place.name}
                  <span className="ml-2 text-xs text-text-muted">
                    {ownedByMe ? 'Your place' : `${suggestionCount} previous suggestion${suggestionCount === 1 ? '' : 's'}`}
                  </span>
                </button>
                <button type="button" className="shrink-0 px-2 py-1 text-xs text-text-muted underline hover:text-accent" disabled={existingPlaces.pendingAction !== null} onClick={() => void existingPlaces.removeSaved(place.id)}>
                  Delete from saved
                </button>
              </li>
            ))}
            {placeFilter.trim() && !placeNameExists && (
              <li>
                <button
                  type="button"
                  className="block w-full rounded-sm border border-dashed border-border-strong px-2 py-1 text-left text-sm hover:bg-surface-raised"
                  onClick={() => {
                    const name = placeFilter.trim();
                    if (isDraft) {
                      setDraftPlaces((rows) => [...rows, { place: { id: `new:${name.toLowerCase()}`, name }, ownedByMe: false, input: { name } }]);
                    } else {
                      void existingPlaces.suggest({ name });
                    }
                    setPlacePickerOpen(false);
                    setPlaceFilter('');
                  }}
                >
                  Add new place: <strong>{placeFilter.trim()}</strong>
                </button>
              </li>
            )}
          </ul>
        </DialogSheetContent>
      </Dialog>
      <GameDetailsSheet
        game={selectedGame}
        groupId={effectiveGroupId}
        open={Boolean(selectedGame)}
        onOpenChange={(open) => { if (!open) setSelectedGame(null); }}
        playDefaults={detail?.proposal.status === 'confirmed' ? {
          groupId: detail.proposal.groupId,
          playedDate: detail.proposal.proposedDate,
          proposalId: detail.proposal.id,
          userIds: detail.rsvps.filter((rsvp) => rsvp.status !== 'no').map((rsvp) => rsvp.userId),
        } : undefined}
        onPlayLogged={onPlayLogged}
      />
      {playGame && detail?.proposal.status === 'confirmed' && <PlayLogDialog
        inline
        game={playGame}
        open
        defaults={{
          groupId: detail.proposal.groupId,
          playedDate: detail.proposal.proposedDate,
          proposalId: detail.proposal.id,
          userIds: detail.rsvps.filter((rsvp) => rsvp.status !== 'no').map((rsvp) => rsvp.userId),
        }}
        onOpenChange={(open) => { if (!open) setPlayGame(null); }}
        onLogged={onPlayLogged}
      />}
    </div>
  );
}
