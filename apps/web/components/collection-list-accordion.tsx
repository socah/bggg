'use client';

import { ReactNode, useId, useState } from 'react';
import { DisclosureChevron } from '@/components/ui/disclosure-chevron';

export function CollectionListAccordion({
  label,
  count,
  expanded,
  onToggle,
  actions,
  children,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const panelId = useId();
  const [hasOpened, setHasOpened] = useState(expanded);
  if (expanded && !hasOpened) setHasOpened(true);

  return (
    <section className="overflow-hidden rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised">
      <div className="flex min-h-12 items-center">
        <button type="button" aria-label={`${label} (${count})`} aria-expanded={expanded} aria-controls={panelId} onClick={onToggle} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 pl-3 pr-2 text-left font-display text-lg transition-colors hover:bg-highlight">
          <DisclosureChevron expanded={expanded} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
        {actions && <div className="shrink-0">{actions}</div>}
        <span className="w-10 shrink-0 text-center font-body text-sm font-semibold text-text-muted">({count})</span>
        <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} aria-expanded={expanded} aria-controls={panelId} onClick={onToggle} className="flex min-h-12 w-12 shrink-0 items-center justify-center transition-colors hover:bg-highlight"><DisclosureChevron expanded={expanded} /></button>
      </div>
      <div id={panelId} aria-hidden={!expanded} inert={!expanded} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          {(expanded || hasOpened) && children && <div className="flex flex-col gap-3 border-t border-border p-2 sm:p-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}
