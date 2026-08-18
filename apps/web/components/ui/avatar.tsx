'use client';

import { forwardRef } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/cn';

export const Avatar = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-2 font-body text-sm font-semibold text-accent-2-ink',
      className
    )}
    {...props}
  />
));
Avatar.displayName = 'Avatar';

export const AvatarImage = AvatarPrimitive.Image;

export const AvatarFallback = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback ref={ref} className={cn('flex h-full w-full items-center justify-center', className)} {...props} />
));
AvatarFallback.displayName = 'AvatarFallback';
