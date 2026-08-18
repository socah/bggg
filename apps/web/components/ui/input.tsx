import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised px-2 py-1.5 font-body text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
