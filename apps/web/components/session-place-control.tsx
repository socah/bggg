'use client';

import { useEffect, useState } from 'react';
import { apiFetch, apiMutate } from '@/lib/api';
import { Input } from '@/components/ui/input';

interface PlaceOption {
  id: string;
  name: string;
}

export function SessionPlaceControl({
  groupId,
  sessionId,
  place,
  options = [],
  canEdit,
  onChanged,
}: {
  groupId: string;
  sessionId: string;
  place: PlaceOption | null;
  options?: PlaceOption[];
  canEdit: boolean;
  onChanged: (place: PlaceOption | null) => void;
}) {
  const [saved, setSaved] = useState<PlaceOption[]>([]);
  const [choice, setChoice] = useState(place?.id ?? '');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void apiFetch('/places/saved').then(async (response) => {
      if (!response.ok) return [];
      return response.json() as Promise<Array<{ place: PlaceOption }>>;
    }).then((rows) => {
      if (!cancelled) setSaved(rows.map((row) => row.place));
    });
    return () => { cancelled = true; };
  }, [canEdit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the control follows refreshed session data.
    setChoice(place?.id ?? '');
  }, [place?.id]);

  if (!canEdit) return <span className="text-xs text-text-muted">{place?.name ?? 'Place not set'}</span>;

  const placeOptions = [...new Map([...options, ...saved, ...(place ? [place] : [])].map((option) => [option.id, option])).values()];

  async function save(nextChoice: string, nextName = '') {
    if (nextChoice === '__new' && !nextName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiMutate(`/groups/${groupId}/sessions/${sessionId}/place`, 'PATCH', nextChoice === '__new' ? { name: nextName.trim() } : { placeId: nextChoice || null });
      const result = await response.json() as { place: PlaceOption | null };
      onChanged(result.place);
      setChoice(result.place?.id ?? '');
      setNewName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not set place');
    } finally {
      setSaving(false);
    }
  }

  return <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
    <div className="flex min-w-0 gap-1">
      {choice === '__new' ? <Input aria-label="New session place" value={newName} maxLength={200} disabled={saving} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save('__new', newName); }} placeholder="Place name (press Enter)" className="h-8 min-h-8 min-w-20 flex-1" /> : <select aria-label="Session place" value={choice} disabled={saving} onChange={(event) => { const nextChoice = event.target.value; setChoice(nextChoice); if (nextChoice !== '__new') void save(nextChoice); }} className="h-8 min-w-20 flex-1 rounded-sm border border-border bg-surface px-1 text-xs text-text"><option value="">No place</option>{placeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}<option value="__new">+ New place</option></select>}
      {choice === '__new' && <button type="button" className="px-1 text-xs text-text-muted" onClick={() => setChoice(place?.id ?? '')}>Cancel</button>}
    </div>
    {error && <span className="mt-1 block text-xs text-accent">{error}</span>}
  </div>;
}
