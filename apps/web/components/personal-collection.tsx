'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Game {
  id: number;
  name: string;
  image: string;
  thumbnail: string;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
  yearPublished: number;
  rating: number;
}

interface ImportSummary {
  added: number;
  removed: number;
  total: number;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export function PersonalCollection() {
  const [games, setGames] = useState<Game[]>([]);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadGames() {
    const accountResponse = await apiFetch('/bgg-account');
    if (!accountResponse.ok) throw new Error(await responseError(accountResponse));
    // Envelope shape — see CollectionsController.getAccount for why the
    // account isn't returned bare.
    const { account } = (await accountResponse.json()) as { account: object | null };
    setLinked(Boolean(account));
    if (!account) {
      setGames([]);
      return;
    }
    const gamesResponse = await apiFetch('/bgg-account/games');
    if (!gamesResponse.ok) throw new Error(await responseError(gamesResponse));
    setGames((await gamesResponse.json()) as Game[]);
  }

  useEffect(() => {
    // Loading from the API is an external synchronization, so the resulting
    // state update intentionally occurs from the effect's async callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGames().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Unable to load collection');
      setLinked(false);
    });
  }, []);

  async function importCollection() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiFetch('/bgg-account/import', { method: 'POST' });
      if (!response.ok) throw new Error(await responseError(response));
      const summary = (await response.json()) as ImportSummary;
      await loadGames();
      setMessage(`Imported ${summary.total} games (${summary.added} added, ${summary.removed} removed).`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Unable to import collection');
    } finally {
      setBusy(false);
    }
  }

  if (linked === null) {
    return <p className="py-12 text-center text-sm text-text-muted">Loading collection…</p>;
  }

  if (!linked) {
    return (
      <Card className="mx-auto max-w-xl p-6 text-center">
        <h2 className="font-display text-xl">Link BGG to see your collection</h2>
        <p className="mt-2 text-sm text-text-muted">Add your username in Settings, then import your owned games.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">My collection</h2>
          <p className="text-sm text-text-muted">{games.length} games</p>
        </div>
        <Button type="button" onClick={importCollection} disabled={busy}>
          {busy ? 'Importing…' : 'Import from BGG'}
        </Button>
      </div>
      {message && <p role="status" className="text-sm text-text-muted">{message}</p>}
      {games.length === 0 ? (
        <Card className="p-6 text-center text-sm text-text-muted">Your collection is empty. Import from BGG to sync it.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <Card key={game.id} className="flex flex-col">
              {(game.image || game.thumbnail) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={game.image || game.thumbnail} alt="" className="aspect-[4/3] w-full object-cover" />
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h3 className="font-display text-lg">{game.name}</h3>
                <div className="flex flex-wrap gap-2">
                  {game.yearPublished > 0 && <Badge>{game.yearPublished}</Badge>}
                  {game.rating > 0 && <Badge>{game.rating.toFixed(1)} BGG</Badge>}
                  {game.minPlayers > 0 && <Badge>{game.minPlayers}–{game.maxPlayers} players</Badge>}
                </div>
                {game.playingTime > 0 && <p className="mt-auto pt-2 text-sm text-text-muted">{game.playingTime} min</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
