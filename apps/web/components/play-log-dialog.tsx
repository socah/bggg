'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useGroups } from '@/hooks/use-groups';
import type { GameCardGame, GroupMemberInfo } from '@/lib/types';

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

async function mutate(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<Response> {
  const response = await apiFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
}: {
  game: GameCardGame | null;
  open: boolean;
  defaults?: PlayLogDefaults;
  editPlayId?: string;
  onOpenChange: (open: boolean) => void;
  onLogged?: () => void;
}) {
  const { groups } = useGroups();
  const [groupId, setGroupId] = useState('');
  const [playedDate, setPlayedDate] = useState(todayKey());
  const [status, setStatus] = useState<'finished' | 'abandoned'>('finished');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [roster, setRoster] = useState<PlayerRoster | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerValue>>({});
  const [guestName, setGuestName] = useState('');
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultUsersKey = defaults?.userIds.join(',') ?? '';

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
    setError(null);
    setPlayers(Object.fromEntries((defaultUsersKey ? defaultUsersKey.split(',') : []).map((id) => [`user:${id}`, { selected: true, isWinner: false, score: '' }])));
  }, [open, game?.id, defaults?.groupId, defaults?.playedDate, defaultUsersKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- groups load after the dialog opens.
    if (open && !groupId && groups[0]) setGroupId(groups[0].id);
  }, [open, groupId, groups]);

  useEffect(() => {
    if (!open || !editPlayId || !defaults?.groupId) return;
    apiFetch(`/groups/${defaults.groupId}/plays/${editPlayId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load this play');
        return response.json() as Promise<{ status: 'finished' | 'abandoned'; durationMinutes: number | null; notes: string | null; players: Array<{ userId: string | null; guestPlayerId: string | null; isWinner: boolean; score: string | null }> }>;
      })
      .then((play) => {
        setStatus(play.status);
        setDuration(play.durationMinutes ? String(play.durationMinutes) : '');
        setNotes(play.notes ?? '');
        setPlayers(Object.fromEntries(play.players.map((player) => [player.userId ? `user:${player.userId}` : `guest:${player.guestPlayerId}`, { selected: true, isWinner: player.isWinner, score: player.score ?? '' }])));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load this play'));
    apiFetch(`/uploads/plays/${editPlayId}`)
      .then((response) => response.ok ? response.json() as Promise<Array<{ id: string; url: string }>> : [])
      .then(setExistingPhotos)
      .catch(() => setExistingPhotos([]));
  }, [open, editPlayId, defaults?.groupId]);

  async function loadRoster(currentGroupId: string) {
    setLoadingRoster(true);
    try {
      const response = await apiFetch(`/groups/${currentGroupId}/play-players`);
      if (!response.ok) throw new Error('Unable to load players');
      const next = (await response.json()) as PlayerRoster;
      setRoster(next);
      setPlayers((current) => {
        if (Object.values(current).some((value) => value.selected)) return current;
        const me = next.members.find((member) => member.isCurrentUser);
        return me ? { [`user:${me.id}`]: { selected: true, isWinner: false, score: '' } } : current;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load players');
    } finally {
      setLoadingRoster(false);
    }
  }

  useEffect(() => {
    if (!open || !groupId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching begins when the selected group changes.
    void loadRoster(groupId);
  }, [open, groupId]);

  function updatePlayer(key: string, patch: Partial<PlayerValue>) {
    setPlayers((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { selected: false, isWinner: false, score: '' }), ...patch },
    }));
  }

  async function addGuest() {
    if (!groupId || !guestName.trim()) return;
    setError(null);
    try {
      const response = await mutate(`/groups/${groupId}/guest-players`, 'POST', { name: guestName.trim() });
      const guest = (await response.json()) as GuestPlayer;
      setGuestName('');
      updatePlayer(`guest:${guest.id}`, { selected: true });
      await loadRoster(groupId);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to link guest player');
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!game || !groupId) return;
    const selectedPlayers = Object.entries(players).filter(([, value]) => value.selected);
    if (selectedPlayers.length === 0) {
      setError('Select at least one player.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await mutate(editPlayId ? `/groups/${groupId}/plays/${editPlayId}` : `/groups/${groupId}/plays`, editPlayId ? 'PATCH' : 'POST', {
        ...(!editPlayId ? { gameId: game.id, playedDate } : {}),
        status,
        ...(!editPlayId && defaults?.proposalId && defaults.groupId === groupId ? { proposalId: defaults.proposalId } : {}),
        ...(duration ? { durationMinutes: Number(duration) } : editPlayId ? { durationMinutes: null } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : editPlayId ? { notes: null } : {}),
        players: selectedPlayers.map(([key, value]) => ({
          ...(key.startsWith('user:') ? { userId: key.slice(5) } : { guestPlayerId: key.slice(6) }),
          isWinner: value.isWinner,
          ...(value.score.trim() ? { score: value.score.trim() } : {}),
        })),
      });
      const play = (await response.json()) as { id: string; sessionId: string };
      for (const photo of photos) await uploadPhoto(photo, play.sessionId, play.id);
      onLogged?.();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to log play');
    } finally {
      setSaving(false);
    }
  }

  const availableGuests = roster?.guests.filter((guest) => !guest.linkedUserId) ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" aria-describedby={undefined}>
        <div className="flex items-start justify-between gap-4">
          <div><DialogTitle className="font-display text-2xl">{editPlayId ? 'Edit' : 'Log'} {game?.name}</DialogTitle><p className="mt-1 text-sm text-text-muted">Record who played and how it went.</p></div>
          <DialogClose className="text-sm text-text-muted">Close</DialogClose>
        </div>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-text-muted">Group
              <select required value={groupId} disabled={saving || Boolean(defaults)} onChange={(event) => { setGroupId(event.target.value); setPlayers({}); }} className="mt-1 min-h-10 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text">
                {groups.map((group) => <option key={group.id} value={group.id}>{group.isSolo ? `${group.name} (solo)` : group.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-text-muted">Date
              <Input required type="date" value={playedDate} disabled={saving || Boolean(defaults)} onChange={(event) => setPlayedDate(event.target.value)} className="mt-1" />
            </label>
            <label className="text-xs font-semibold text-text-muted">Status
              <select value={status} disabled={saving} onChange={(event) => setStatus(event.target.value as 'finished' | 'abandoned')} className="mt-1 min-h-10 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text"><option value="finished">Finished</option><option value="abandoned">Abandoned</option></select>
            </label>
            <label className="text-xs font-semibold text-text-muted">Duration (minutes, optional)
              <Input type="number" min="1" max="10080" value={duration} disabled={saving} onChange={(event) => setDuration(event.target.value)} className="mt-1" />
            </label>
          </div>

          <section>
            <h3 className="font-display text-lg">Players</h3>
            {loadingRoster && <p className="mt-2 text-sm text-text-muted">Loading players...</p>}
            <div className="mt-2 flex flex-col gap-2">
              {[...(roster?.members ?? []).map((member) => ({ key: `user:${member.id}`, name: member.displayName || member.username })), ...availableGuests.map((guest) => ({ key: `guest:${guest.id}`, name: `${guest.name} (guest)` }))].map((player) => {
                const value = players[player.key] ?? { selected: false, isWinner: false, score: '' };
                return <div key={player.key} className="grid gap-2 rounded-sm border border-border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto_10rem] sm:items-center">
                  <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={value.selected} disabled={saving} onChange={(event) => updatePlayer(player.key, { selected: event.target.checked })} />{player.name}</label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value.isWinner} disabled={saving || !value.selected} onChange={(event) => updatePlayer(player.key, { isWinner: event.target.checked })} />Winner</label>
                  <Input aria-label={`${player.name} score`} placeholder="Score (optional)" maxLength={100} value={value.score} disabled={saving || !value.selected} onChange={(event) => updatePlayer(player.key, { score: event.target.value })} />
                </div>;
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Input aria-label="New guest player name" placeholder="Add a player without an account" maxLength={100} value={guestName} disabled={saving || !groupId} onChange={(event) => setGuestName(event.target.value)} />
              <Button type="button" variant="secondary" disabled={saving || !guestName.trim()} onClick={() => void addGuest()}>Add player</Button>
            </div>
          </section>

          {roster?.canManageGuests && availableGuests.length > 0 && (
            <section className="rounded-sm border border-border p-3">
              <h3 className="font-display text-base">Link guest to account</h3>
              <p className="mt-1 text-xs text-text-muted">This merges the guest&apos;s previous plays into the selected member.</p>
              {availableGuests.map((guest) => <div key={guest.id} className="mt-2 flex flex-wrap items-center gap-2"><span className="min-w-28 text-sm font-semibold">{guest.name}</span><select aria-label={`Account for ${guest.name}`} value={linkTargets[guest.id] ?? ''} onChange={(event) => setLinkTargets((current) => ({ ...current, [guest.id]: event.target.value }))} className="min-h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 text-sm"><option value="">Choose member</option>{roster.members.map((member) => <option key={member.id} value={member.id}>{member.displayName || member.username}</option>)}</select><Button type="button" variant="secondary" disabled={saving || !linkTargets[guest.id]} onClick={() => void linkGuest(guest)}>Link and merge</Button></div>)}
            </section>
          )}

          <label className="text-xs font-semibold text-text-muted">Notes (optional)
            <textarea rows={3} maxLength={5000} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full resize-y rounded-sm border border-border bg-surface p-2 text-sm text-text" />
          </label>
          <label className="text-xs font-semibold text-text-muted">Photos (optional)
            <Input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving} onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} className="mt-1" />
            {photos.length > 0 && <span className="mt-1 block font-normal">{photos.length} photo{photos.length === 1 ? '' : 's'} selected</span>}
          </label>
          {existingPhotos.length > 0 && <div className="grid grid-cols-3 gap-2">{existingPhotos.map((photo) => (
            // Presigned R2 hosts are runtime-configured and cannot be listed in next/image config.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={photo.id} src={photo.url} alt="Play" className="aspect-square w-full rounded-sm object-cover" />
          ))}</div>}
          {error && <p role="alert" className="text-sm text-accent">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving || !game || !groupId}>{saving ? 'Saving...' : editPlayId ? 'Save changes' : 'Log play'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
