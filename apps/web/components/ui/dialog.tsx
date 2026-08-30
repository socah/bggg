'use client';

import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;

export const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-40 bg-black/40', className)} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

// A right-side sheet, not a centered modal — apps/web's proposal detail
// panel has always been a slide-over; this keeps that positioning while
// gaining Radix's focus trap / Escape-to-close / backdrop for free.
export const DialogSheetContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed inset-y-0 right-0 z-50 w-80 overflow-y-auto bg-surface-raised p-4', className)}
      style={{
        borderLeft: 'var(--border-w) solid var(--border)',
        boxShadow: 'var(--shadow-card)',
        ...style,
      }}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogSheetContent.displayName = 'DialogSheetContent';

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface-raised p-6 rounded-md focus:outline-none max-w-sm w-full',
        className
      )}
      style={{
        border: 'var(--border-w) solid var(--border)',
        boxShadow: 'var(--shadow-card)',
        ...style,
      }}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

