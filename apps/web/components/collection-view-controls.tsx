'use client';

import { Input } from '@/components/ui/input';

export function CollectionViewControls({ playerCount, onPlayerCountChange, sort, sortOptions, onSortChange, view, onViewChange }: {
  playerCount: string;
  onPlayerCountChange: (value: string) => void;
  sort: string;
  sortOptions: Array<{ value: string; label: string }>;
  onSortChange: (value: string) => void;
  view: 'compact' | 'list';
  onViewChange: (value: 'compact' | 'list') => void;
}) {
  function changeCount(delta: number) {
    const next = (Number(playerCount) || 0) + delta;
    onPlayerCountChange(next > 0 ? String(next) : '');
  }

  return <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] gap-1.5 sm:grid-cols-3 sm:gap-2">
    <span className="flex min-w-0" aria-label="Player count" title="Player count">
      <button type="button" onClick={() => changeCount(-1)} className="min-h-9 w-8 shrink-0 rounded-l-sm border-[length:var(--border-w)] border-border text-lg sm:min-h-10 sm:w-10" aria-label="Decrease player count">-</button>
      <Input inputMode="numeric" value={playerCount} placeholder="Any" onChange={(event) => onPlayerCountChange(event.target.value.replace(/\D/g, ''))} aria-label="Player count value" title="Player count" className="min-w-0 rounded-none px-0 text-center sm:px-2" />
      <button type="button" onClick={() => changeCount(1)} className="min-h-9 w-8 shrink-0 rounded-r-sm border-[length:var(--border-w)] border-border text-lg sm:min-h-10 sm:w-10" aria-label="Increase player count">+</button>
    </span>
    <select aria-label="Sort by" title="Sort by" value={`display:${sort}`} onChange={(event) => onSortChange(event.target.value)} className="min-h-9 min-w-0 rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised px-1 text-sm text-text sm:min-h-10 sm:px-2">
      <option value={`display:${sort}`} hidden>{sortOptions.find((option) => option.value === sort)?.label}</option>
      {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <div className="flex min-h-9 overflow-hidden rounded-sm border-[length:var(--border-w)] border-border sm:min-h-10" aria-label="View style">
      <button type="button" aria-label="Grid" title="Grid" aria-pressed={view === 'compact'} onClick={() => onViewChange('compact')} className={`flex flex-1 items-center justify-center gap-1.5 px-1 text-sm font-semibold sm:px-3 ${view === 'compact' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}><svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="currentColor"><path d="M2 2h6v6H2zm10 0h6v6h-6zM2 12h6v6H2zm10 0h6v6h-6z" /></svg><span className="hidden sm:inline">Grid</span></button>
      <button type="button" aria-label="List" title="List" aria-pressed={view === 'list'} onClick={() => onViewChange('list')} className={`flex flex-1 items-center justify-center gap-1.5 border-l border-border px-1 text-sm font-semibold sm:px-3 ${view === 'list' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}><svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="currentColor"><path d="M2 3h3v3H2zm5 0h11v3H7zM2 9h3v3H2zm5 0h11v3H7zM2 15h3v3H2zm5 0h11v3H7z" /></svg><span className="hidden sm:inline">List</span></button>
    </div>
  </div>;
}
