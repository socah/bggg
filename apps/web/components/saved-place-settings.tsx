'use client';

import { useEffect, useState } from 'react';
import { apiFetch, apiMutate } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface SavedPlace {
  place: { id: string; name: string };
  canEdit: boolean;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export function SavedPlaceSettings() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch('/places/saved')
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<SavedPlace[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        setPlaces(rows);
        setNames(Object.fromEntries(rows.map(({ place }) => [place.id, place.name])));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load saved places');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function rename(row: SavedPlace) {
    const name = names[row.place.id]?.trim() ?? '';
    if (!name) {
      setError('Place name must not be blank');
      return;
    }
    if (name === row.place.name) return;

    setPending(`rename:${row.place.id}`);
    setError(null);
    try {
      const response = await apiMutate(`/places/${row.place.id}`, 'PATCH', { name });
      const updated = await response.json() as { id: string; name: string };
      setPlaces((current) => current.map((item) => item.place.id === updated.id
        ? { ...item, place: updated }
        : item));
      setNames((current) => ({ ...current, [updated.id]: updated.name }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to rename place');
    } finally {
      setPending(null);
    }
  }

  async function remove(row: SavedPlace) {
    if (!window.confirm(`Remove ${row.place.name} from your saved places?`)) return;
    setPending(`remove:${row.place.id}`);
    setError(null);
    try {
      await apiMutate(`/places/${row.place.id}/saved`, 'DELETE');
      setPlaces((current) => current.filter((item) => item.place.id !== row.place.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove saved place');
    } finally {
      setPending(null);
    }
  }

  if (loading) return <p className="text-sm text-text-muted" role="status">Loading saved places...</p>;

  return (
    <div className="max-w-2xl">
      {error && <p className="mb-3 text-sm text-accent" role="alert">{error}</p>}
      {places.length === 0 ? (
        <Card className="p-4 text-sm text-text-muted">You do not have any saved places yet.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {places.map((row) => {
              const isPending = pending?.endsWith(row.place.id) ?? false;
              const name = names[row.place.id] ?? row.place.name;
              return (
                <li key={row.place.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    {row.canEdit ? (
                      <label className="flex flex-col gap-1 text-sm font-semibold">
                        Place name
                        <Input
                          value={name}
                          maxLength={100}
                          disabled={isPending}
                          onChange={(event) => setNames((current) => ({ ...current, [row.place.id]: event.target.value }))}
                        />
                      </label>
                    ) : (
                      <div>
                        <p className="font-semibold text-text">{row.place.name}</p>
                        <p className="text-xs text-text-muted">Only the person who created this place can rename it.</p>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {row.canEdit && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isPending || !name.trim() || name.trim() === row.place.name}
                        onClick={() => void rename(row)}
                      >
                        {pending === `rename:${row.place.id}` ? 'Saving...' : 'Save'}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-accent"
                      disabled={isPending}
                      onClick={() => void remove(row)}
                    >
                      {pending === `remove:${row.place.id}` ? 'Removing...' : 'Remove'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
