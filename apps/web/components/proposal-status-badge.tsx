import type { ProposalStatus } from '@/lib/types';
import { cn } from '@/lib/cn';

const LABELS: Record<ProposalStatus, string> = {
  collecting: 'Collecting RSVPs',
  confirming: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

const COLORS: Record<ProposalStatus, string> = {
  collecting: 'bg-amber-100 text-amber-950',
  confirming: 'bg-sky-100 text-sky-950',
  confirmed: 'bg-emerald-100 text-emerald-950',
  cancelled: 'bg-slate-200 text-slate-950',
};

export function proposalStatusClasses(status: ProposalStatus): string {
  return COLORS[status];
}

export function ProposalStatusBadge({ status, className }: { status: ProposalStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-xs font-semibold', proposalStatusClasses(status), className)}>
      {LABELS[status]}
    </span>
  );
}
