import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Badge({ className, style, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 font-mono text-xs font-medium text-text',
        className
      )}
      style={{ transform: 'rotate(var(--badge-rotate))', ...style }}
      {...props}
    />
  );
}
