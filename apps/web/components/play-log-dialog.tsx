'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { UserIdentityLink } from '@/components/user-identity-link';
import { apiFetch } from '@/lib/api';
import { useGroups } from '@/hooks/use-groups';
import type { GameCardGame, GroupMemberInfo } from '@/lib/types';
import { groupDisplayName, groupUsername } from '@/lib/user-identity';

interface GuestPlayer {
  id: string;
  groupId: string;
  name: string;
  linkedUserId: string | null;
}

interface PlayerRoster {
  members: GroupMemberInfo[];
  guests: GuestPlayer[];
  canManageGuests: boolean;
  sessionId: string | null;
  sessionPlayerIds: string[];
}

interface PlayerValue {
  selected: boolean;
  isWinner: boolean;
  score: string;
}

export interface PlayLogDefaults {
  groupId: string;
  playedDate: string;
  proposalId?: string;
  userIds: string[];
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<Response> {
  const response = await apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message;
    throw new Error(message || response.statusText || 'Request failed');
  }
  return response;
}

export function PlayLogDialog({
  game,
  open,
  defaults,
  editPlayId,
  onOpenChange,
  onLogged,
  inline = false,
  embedded = false,
}: {
  game: GameCardGame | null;
  open: boolean;
  defaults?: PlayLogDefaults;
  editPlayId?: string;
  onOpenChange: (open: boolean) => void;
  onLogged?: () => void;
  inline?: boolean;
  embedded?: boolean;
}) {
  const { groups } = useGroups();
  const [groupId, setGroupId] = useState('');
  const [playedDate, setPlayedDate] = useState(todayKey());
  const [status, setStatus] = useState<'finished' | 'abandoned'>('finished');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [roster, setRoster] = useState<PlayerRoster | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerValue>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [guestSettingsId, setGuestSettingsId] = useState<string | null>(null);
  const [guestSettingsOpen, setGuestSettingsOpen] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(Boolean(editPlayId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPlayId, setCreatedPlayId] = useState<string | null>(null);
  const [creationFailed, setCreationFailed] = useState(false);
  const [creationAttempt, setCreationAttempt] = useState(0);
  const rosterRequest = useRef(0);
  const playRequest = useRef(0);
  const createStarted = useRef(false);
  const defaultUsersKey = defaults?.userIds.join(',') ?? '';
  const defaultProposalId = defaults?.proposalId;
  const defaultGroupId = defaults?.groupId;

  useEffect(() => {
    if (!open) return;
    const nextGroupId = defaults?.groupId ?? '';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening a dialog initializes a new form resource.
    setGroupId(nextGroupId);
    setPlayedDate(defaults?.playedDate ?? todayKey());
    setStatus('finished');
    setDuration('');
    setNotes('');
    setPhotos([]);
    setExistingPhotos([]);
    setPlayerPickerOpen(false);
    setGuestSettingsId(null);
    setGuestSettingsOpen(false);
    setError(null);
    setCreatedPlayId(null);
    setCreationFailed(false);
    setCreationAttempt(0);
    setLoadingPlay(Boolean(editPlayId));
    createStarted.current = false;
    setRoster(null);
    setSessionId(null);
    setGuestName('');
    setLinkTargets({});
    setPlayers(Object.fromEntries((defaultUsersKey ? defaultUsersKey.split(',') : []).map((id) => [`user:${id}`, { selected: true, isWinner: false, score: '' }])));
  }, [open, game?.id, editPlayId, defaults?.groupId, defaults?.playedDate, defaultUsersKey]);

  useEffect(() => {
    if (!open || !editPlayId || !defaults?.groupId) return;
    const requestId = ++playRequest.current;
    apiFetch(`/groups/${defaults.groupId}/plays/${editPlayId}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load this play');
        return response.json() as Promise<{ status: 'finished' | 'abandoned'; durationMinutes: number | null; notes: string | null; players: Array<{ userId: string | null; guestPlayerId: string | null; isWinner: boolean; score: string | null }> }>;
      })
      .then((play) => {
        if (requestId !== playRequest.current) return;
        setStatus(play.status);
        setDuration(play.durationMinutes ? String(play.durationMinutes) : '');
        setNotes(play.notes ?? '');
        setPlayers(Object.fromEntries(play.players.map((player) => [player.userId ? `user:${player.userId}` : `guest:${player.guestPlayerId}`, { selected: true, isWinner: player.isWinner, score: player.score ?? '' }])));
      })
      .catch((reason: unknown) => {
        if (requestId === playRequest.current) setError(reason instanceof Error ? reason.message : 'Unable to load this play');
      })
      .finally(() => {
        if (requestId === playRequest.current) setLoadingPlay(false);
      });
    apiFetch(`/uploads/plays/${editPlayId}`)
      .then((response) => response.ok ? response.json() as Promise<Array<{ id: string; url: string }>> : [])
      .then(setExistingPhotos)
      .catch(() => setExistingPhotos([]));
    return () => { playRequest.current += 1; };
  }, [open, editPlayId, defaults?.groupId]);

  const loadRoster = useCallback(async (currentGroupId: string) => {
    const requestId = ++rosterRequest.current;
    setLoadingRoster(true);
    try {
      const query = new URLSearchParams({ playedDate });
      if (defaultProposalId && defaultGroupId === currentGroupId) query.set('proposalId', defaultProposalId);
      const response = await apiFetch(`/groups/${currentGroupId}/play-players?${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load players');
      const next = (await response.json()) as PlayerRoster;
      if (requestId !== rosterRequest.current) return;
      setRoster(next);
      setSessionId(next.sessionId);
      setPlayers((current) => {
        if (!editPlayId && next.sessionPlayerIds.length > 0) {
          return Object.fromEntries(next.sessionPlayerIds.map((id) => [id, current[id] ?? { selected: true, isWinner: false, score: '' }]));
        }
        if (editPlayId) return current;
        if (Object.values(current).some((value) => value.selected)) return current;
        const me = next.members.find((member) => member.isCurrentUser);
        return me ? { [`user:${me.id}`]: { selected: true, isWinner: false, score: '' } } : current;
      });
    } catch (reason) {
      if (requestId === rosterRequest.current) setError(reason instanceof Error ? reason.message : 'Unable to load players');
    } finally {
      if (requestId === rosterRequest.current) setLoadingRoster(false);
    }
  }, [playedDate, defaultProposalId, defaultGroupId, editPlayId]);

  useEffect(() => {
    if (!open || !groupId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching begins when the selected group changes.
    void loadRoster(groupId);
    return () => { rosterRequest.current += 1; };
  }, [open, groupId, loadRoster]);

  const currentPlayId = editPlayId ?? createdPlayId;

  function selectedPlayerPayload(nextPlayers = players) {
    return Object.entries(nextPlayers).filter(([, value]) => value.selected).map(([key, value]) => ({
      ...(key.startsWith('user:') ? { userId: key.slice(5) } : { guestPlayerId: key.slice(6) }),
      isWinner: value.isWinner,
      ...(value.score.trim() ? { score: value.score.trim() } : {}),
    }));
  }

  async function savePlay(overrides: { status?: 'finished' | 'abandoned'; duration?: string; notes?: string; players?: Record<string, PlayerValue> } = {}) {
    if (!currentPlayId || !groupId) return;
    const nextPlayers = overrides.players ?? players;
    const playerPayload = selectedPlayerPayload(nextPlayers);
    if (playerPayload.length === 0) {
      setError('Select at least one player.');
      return;
    }
    const nextDuration = overrides.duration ?? duration;
    const nextNotes = overrides.notes ?? notes;
    setSaving(true);
    setError(null);
    try {
      await mutate(`/groups/${groupId}/plays/${currentPlayId}`, 'PATCH', {
        status: overrides.status ?? status,
        durationMinutes: nextDuration ? Number(nextDuration) : null,
        notes: nextNotes.trim() || null,
        players: playerPayload,
      });
      onLogged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save play');
    } finally {
      setSaving(false);
    }
  }

  function updatePlayer(key: string, patch: Partial<PlayerValue>, persist = false) {
    const next = {
      ...players,
      [key]: { ...(players[key] ?? { selected: false, isWinner: false, score: '' }), ...patch },
    };
    setPlayers(next);
    if (persist) void savePlay({ players: next });
  }

  async function addGuest() {
    if (!groupId || !guestName.trim()) return;
    setError(null);
    try {
      const response = await mutate(`/groups/${groupId}/guest-players`, 'POST', { name: guestName.trim() });
      const guest = (await response.json()) as GuestPlayer;
      setGuestName('');
      setRoster((current) => current ? {
        ...current,
        guests: [...current.guests.filter((candidate) => candidate.id !== guest.id), guest]
          .sort((left, right) => left.name.localeCompare(right.name)),
      } : current);
      updatePlayer(`guest:${guest.id}`, { selected: true }, Boolean(currentPlayId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add guest player');
    }
  }

  async function linkGuest(guest: GuestPlayer) {
    const userId = linkTargets[guest.id];
    if (!userId) return;
    setError(null);
    try {
      await mutate(`/groups/${groupId}/guest-players/${guest.id}/link`, 'PATCH', { userId });
      const previous = players[`guest:${guest.id}`];
      setPlayers((current) => {
        const next = { ...current };
        delete next[`guest:${guest.id}`];
        if (previous?.selected) next[`user:${userId}`] = previous;
        return next;
      });
      await loadRoster(groupId);
      setGuestSettingsOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to link guest player');
    }
  }

  async function removeGuest(guest: GuestPlayer) {
    if (!window.confirm(`Remove ${guest.name} from the player list? Their name will remain on past plays.`)) return;
    setError(null);
    try {
      await mutate(`/groups/${groupId}/guest-players/${guest.id}`, 'DELETE');
      setPlayers((current) => {
        const next = { ...current };
        delete next[`guest:${guest.id}`];
        return next;
      });
      setGuestSettingsOpen(false);
      await loadRoster(groupId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove guest player');
    }
  }

  async function uploadPhoto(file: File, sessionId: string, playId: string) {
    const presignResponse = await mutate('/uploads/presign', 'POST', {
      sessionId,
      playId,
      contentType: file.type,
      contentLength: file.size,
    });
    const presign = (await presignResponse.json()) as { url: string; key: string };
    const uploadResponse = await fetch(presign.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!uploadResponse.ok) throw new Error(`Could not upload ${file.name}`);
    await mutate('/uploads/confirm', 'POST', { sessionId, playId, key: presign.key });
  }

  useEffect(() => {
    if (!open || editPlayId || createdPlayId || createStarted.current || !game || !groupId || !roster) return;
    const playerPayload = selectedPlayerPayload();
    if (playerPayload.length === 0) return;
    createStarted.current = true;
    void Promise.resolve().then(() => {
      setSaving(true);
      setError(null);
      setCreationFailed(false);
      return mutate(`/groups/${groupId}/plays`, 'POST', {
      gameId: game.id,
      playedDate,
      ...(sessionId ? { sessionId } : {}),
      status,
      ...(defaults?.proposalId && defaults.groupId === groupId ? { proposalId: defaults.proposalId } : {}),
      players: playerPayload,
      });
    }).then(async (response) => {
      const play = (await response.json()) as { id: string; sessionId: string };
      setCreatedPlayId(play.id);
      setSessionId(play.sessionId);
      onLogged?.();
    }).catch((reason: unknown) => {
      createStarted.current = false;
      setCreationFailed(true);
      setError(reason instanceof Error ? reason.message : 'Unable to log play');
    }).finally(() => setSaving(false));
    // Creation is intentionally gated by createStarted; later field changes are autosaved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editPlayId, createdPlayId, game, groupId, roster, players, playedDate, sessionId, status, defaults?.proposalId, defaults?.groupId, creationAttempt]);

  async function addPhotos(files: File[]) {
    if (!currentPlayId || !sessionId || files.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const photo of files) await uploadPhoto(photo, sessionId, currentPlayId);
      const response = await apiFetch(`/uploads/plays/${currentPlayId}`);
      if (response.ok) setExistingPhotos(await response.json() as Array<{ id: string; url: string }>);
      setPhotos([]);
      onLogged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to upload photos');
    } finally {
      setSaving(false);
    }
  }

  async function deletePlay() {
    if (!currentPlayId || !groupId || !window.confirm('Delete this logged play? This cannot be undone.')) return;
    setSaving(true);
    setError(null);
    try {
      await mutate(`/groups/${groupId}/plays/${currentPlayId}`, 'DELETE');
      onLogged?.();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete play');
    } finally {
      setSaving(false);
    }
  }

  const availableGuests = roster?.guests.filter((guest) => !guest.linkedUserId) ?? [];
  const rosterPlayers = [
    ...(roster?.members ?? []).map((member) => ({ key: `user:${member.id}`, name: groupUsername(member), member, guest: null })),
    ...availableGuests.map((guest) => ({ key: `guest:${guest.id}`, name: `${guest.name} (guest)`, member: null, guest })),
  ];
  const selectedPlayers = rosterPlayers.filter((player) => players[player.key]?.selected);
  const guestWithSettings = availableGuests.find((guest) => guest.id === guestSettingsId);
  const content = <>
        {!embedded && (
        <div className="flex items-start justify-between gap-4">
          <div>{inline ? <h3 className="font-display text-xl">{currentPlayId ? 'Edit' : 'Log'} {game?.name}</h3> : <DialogTitle className="font-display text-2xl">{currentPlayId ? 'Edit' : 'Log'} {game?.name}</DialogTitle>}<p className="mt-1 text-sm text-text-muted">Changes are saved automatically.</p></div>
          {!inline && <DialogClose className="text-sm text-text-muted">Close</DialogClose>}
        </div>
        )}
        <form onSubmit={(event) => event.preventDefault()} className={`${embedded ? '' : 'mt-5'} flex flex-col gap-5`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2 text-xs font-semibold text-text-muted"><span>Group</span>
              <select required value={groupId} disabled={saving || Boolean(defaults?.groupId)} onChange={(event) => { setGroupId(event.target.value); setRoster(null); setSessionId(null); setPlayers({}); }} className="h-10 min-h-10 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text">
                {!defaults?.groupId && <option value="" disabled>Choose a group</option>}
                {groups.map((group) => <option key={group.id} value={group.id}>{group.isSolo ? `${group.name} (solo)` : group.name}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-xs font-semibold text-text-muted"><span>Date</span>
              <Input required type="date" lang="en-GB" max={todayKey()} value={playedDate} disabled={saving || Boolean(defaults)} onChange={(event) => { setPlayedDate(event.target.value); setSessionId(null); setPlayers({}); }} className="h-10 min-h-10 w-full" />
            </label>
            <fieldset className="min-w-0 text-xs font-semibold text-text-muted">
              <legend>Status</legend>
              <div className="mt-2 flex h-10 min-h-10 w-full overflow-hidden rounded-sm border border-border" aria-label="Play status">
                 {(['finished', 'abandoned'] as const).map((value) => <button key={value} type="button" aria-pressed={status === value} disabled={saving || !currentPlayId} onClick={() => { setStatus(value); void savePlay({ status: value }); }} className={`flex-1 px-3 text-sm font-semibold capitalize ${status === value ? 'bg-accent-2 text-accent-2-ink' : 'bg-surface text-text-muted'}`}>{value}</button>)}
              </div>
            </fieldset>
            <label className="flex min-w-0 flex-col gap-2 text-xs font-semibold text-text-muted"><span>Duration (minutes)</span>
              <Input type="number" min="1" max="10080" value={duration} disabled={saving || !currentPlayId} onChange={(event) => setDuration(event.target.value)} onBlur={() => void savePlay()} className="h-10 min-h-10 w-full" />
            </label>
          </div>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg">Players</h3>
              <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" disabled={saving || loadingRoster || loadingPlay} onClick={() => setPlayerPickerOpen((current) => !current)} aria-expanded={playerPickerOpen}>+ Add player</Button>
            </div>
            {(loadingRoster || loadingPlay) && <p className="mt-2 text-sm text-text-muted">Loading players...</p>}
            <div className="mt-2 flex flex-col gap-2">
              {selectedPlayers.map((player) => {
                 const value = players[player.key] ?? { selected: false, isWinner: false, score: '' };
                  return <div key={player.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-sm border border-border bg-surface p-2 sm:grid-cols-[minmax(0,1fr)_auto_10rem_auto] sm:gap-2 sm:p-3">
                     <div className="flex min-w-0 items-center justify-between gap-2"><strong className="truncate">{player.member ? <UserIdentityLink user={player.member} groupId={groupId} /> : player.name}</strong>{player.guest && roster?.canManageGuests && <button type="button" className="min-h-9 shrink-0 px-2 text-xs font-semibold text-text-muted underline" onClick={() => { setGuestSettingsId(player.guest!.id); setGuestSettingsOpen(true); }}>Settings</button>}</div>
                    <label className="col-start-1 row-start-2 flex items-center gap-2 text-xs sm:col-auto sm:row-auto"><input type="checkbox" checked={value.isWinner} disabled={saving || !currentPlayId || !value.selected} onChange={(event) => updatePlayer(player.key, { isWinner: event.target.checked }, true)} />Winner</label>
                    <Input className="col-start-2 row-start-2 h-9 min-h-9 w-28 sm:col-auto sm:row-auto sm:h-11 sm:w-auto" aria-label={`${player.name} score`} placeholder="Score" maxLength={100} value={value.score} disabled={saving || !currentPlayId || !value.selected} onChange={(event) => updatePlayer(player.key, { score: event.target.value })} onBlur={() => void savePlay()} />
                    <button type="button" className="col-start-2 row-start-1 min-h-8 px-1 text-xs font-semibold text-accent sm:col-auto sm:row-auto sm:min-h-9 sm:px-2" disabled={saving || !currentPlayId || selectedPlayers.length === 1} onClick={() => updatePlayer(player.key, { selected: false, isWinner: false, score: '' }, true)}>Remove</button>
                 </div>;
               })}
              {!loadingRoster && !loadingPlay && selectedPlayers.length === 0 && <p className="text-sm text-text-muted">No players selected.</p>}
            </div>
            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${playerPickerOpen ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`} aria-hidden={!playerPickerOpen} inert={!playerPickerOpen}>
              <div className="overflow-hidden"><div className="rounded-sm border border-border bg-surface-raised p-3">
              <div className="flex flex-col gap-1">
                 {rosterPlayers.filter((player) => !players[player.key]?.selected).map((player) => <div key={player.key} className="flex min-h-10 items-center justify-between gap-2 border-b border-border py-1 last:border-0"><span className="text-sm font-semibold">{player.member ? <UserIdentityLink user={player.member} groupId={groupId} /> : player.name}</span><span className="flex gap-1">{player.guest && roster?.canManageGuests && <button type="button" className="px-2 text-xs text-text-muted underline" onClick={() => { setGuestSettingsId(player.guest!.id); setGuestSettingsOpen(true); }}>Settings</button>}<Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" disabled={saving || !currentPlayId} onClick={() => updatePlayer(player.key, { selected: true }, true)}>Add</Button></span></div>)}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input className="min-w-0 flex-1" aria-label="New guest player name" placeholder="Player without an account" maxLength={100} value={guestName} disabled={saving || !groupId} onChange={(event) => setGuestName(event.target.value)} />
                <Button type="button" variant="secondary" disabled={saving || !guestName.trim()} onClick={() => void addGuest()}>Add guest</Button>
              </div></div>
            </div></div>
            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${guestSettingsOpen && guestWithSettings && roster?.canManageGuests ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`} aria-hidden={!guestSettingsOpen} inert={!guestSettingsOpen}>
              <div className="overflow-hidden">{guestWithSettings && roster?.canManageGuests && <div className="rounded-sm border border-border p-3">
              <div className="flex items-center justify-between gap-2"><h4 className="font-display text-base">{guestWithSettings.name} settings</h4><button type="button" className="text-xs text-text-muted" onClick={() => setGuestSettingsOpen(false)}>Close</button></div>
              <p className="mt-1 text-xs text-text-muted">Linking merges this guest&apos;s previous plays into a member account.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row"><select aria-label={`Account for ${guestWithSettings.name}`} value={linkTargets[guestWithSettings.id] ?? ''} onChange={(event) => setLinkTargets((current) => ({ ...current, [guestWithSettings.id]: event.target.value }))} className="min-h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 text-sm"><option value="">Choose member</option>{roster.members.map((member) => <option key={member.id} value={member.id}>{groupDisplayName(member)}</option>)}</select><Button type="button" variant="secondary" disabled={saving || !linkTargets[guestWithSettings.id]} onClick={() => void linkGuest(guestWithSettings)}>Link and merge</Button></div>
              <Button type="button" variant="ghost" className="mt-2 min-h-9 px-0 text-xs text-accent" disabled={saving} onClick={() => void removeGuest(guestWithSettings)}>Remove from player list</Button>
            </div>}</div></div>
          </section>

          <label className="text-xs font-semibold text-text-muted">Notes
            <textarea rows={3} maxLength={5000} value={notes} disabled={saving || !currentPlayId} onChange={(event) => setNotes(event.target.value)} onBlur={() => void savePlay()} className="mt-1 w-full resize-y rounded-sm border border-border bg-surface p-2 text-sm text-text" />
          </label>
          <label className="text-xs font-semibold text-text-muted">Photos
            <Input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving || !currentPlayId} onChange={(event) => { const files = Array.from(event.target.files ?? []); setPhotos(files); void addPhotos(files); }} className="mt-1" />
            {photos.length > 0 && <span className="mt-1 block font-normal">{photos.length} photo{photos.length === 1 ? '' : 's'} selected</span>}
          </label>
          {existingPhotos.length > 0 && <div className="grid grid-cols-3 gap-2">{existingPhotos.map((photo) => (
            // Presigned R2 hosts are runtime-configured and cannot be listed in next/image config.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={photo.id} src={photo.url} alt="Play" className="aspect-square w-full rounded-sm object-cover" />
          ))}</div>}
          {error && <p role="alert" className="text-sm text-accent">{error}</p>}
          <div className="flex min-h-10 flex-wrap items-center gap-2">{currentPlayId && <Button type="button" variant="ghost" className="text-accent" disabled={saving} onClick={() => void deletePlay()}>Delete play</Button>}{creationFailed && <Button type="button" variant="secondary" disabled={saving} onClick={() => setCreationAttempt((current) => current + 1)}>Retry creating play</Button>}<span className="ml-auto text-xs text-text-muted" role="status">{saving ? (currentPlayId ? 'Saving...' : 'Creating play...') : currentPlayId ? 'Changes saved automatically' : creationFailed ? 'Play was not created' : 'Preparing play...'}</span></div>
        </form>
  </>;

  if (inline) return <div className={`${embedded ? '' : 'rounded-md border border-border'} bg-surface-raised p-4`} style={embedded ? undefined : { boxShadow: 'var(--shadow-card)' }}>{content}</div>;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" aria-describedby={undefined}>
        {content}
      </DialogContent>
    </Dialog>
  );
}
