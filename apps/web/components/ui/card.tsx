import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface border-[length:var(--border-w)] border-border overflow-hidden',
        className
      )}
      style={{ boxShadow: 'var(--shadow-card)', ...style }}
      {...props}
    />
  );
}
