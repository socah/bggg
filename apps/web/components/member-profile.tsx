'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { GameCardGame, GroupMemberProfile } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { GameDetailsSheet, LibraryGame } from '@/components/personal-collection';

export function MemberProfile({ groupId, userId }: { groupId: string; userId: string }) {
  const [profile, setProfile] = useState<GroupMemberProfile | null>(null);
  const [selected, setSelected] = useState<GameCardGame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/groups/${groupId}/members/${encodeURIComponent(userId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Member not found' : 'Unable to load member profile');
        return response.json() as Promise<GroupMemberProfile>;
      })
      .then((next) => { if (!cancelled) setProfile(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load member profile'); });
    return () => { cancelled = true; };
  }, [groupId, userId]);

  if (error) return <p role="alert" className="text-sm text-accent">{error}</p>;
  if (!profile) return <p role="status" className="text-sm text-text-muted">Loading member profile...</p>;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <p className="font-mono text-sm font-semibold text-accent-2">@{profile.username}</p>
        {profile.displayName !== profile.username && <h1 className="mt-1 font-display text-2xl">{profile.displayName}</h1>}
        <Badge className="mt-3">{profile.role}</Badge>
      </Card>
      <section>
        <h2 className="font-display text-xl">Collection <span className="text-sm text-text-muted">({profile.ownedGames.length})</span></h2>
        {profile.ownedGames.length === 0 ? <Card className="mt-3 p-6 text-sm text-text-muted">No games in this collection.</Card> : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {profile.ownedGames.map((game) => <LibraryGame key={game.id} game={game} view="compact" onOpen={() => setSelected(game)} />)}
          </div>
        )}
      </section>
      <GameDetailsSheet game={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
