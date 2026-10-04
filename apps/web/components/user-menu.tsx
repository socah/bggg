'use client';

import Link from 'next/link';
import { logOut } from '@/lib/logout';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function UserMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      {/* The visible avatar stays 36px, but the tappable trigger is padded
          out to the 44px minimum touch target — on mobile this is the only
          route to "Log out". */}
      <DropdownMenuTrigger
        aria-label={`Account menu for ${name}`}
        className="flex min-h-11 min-w-11 items-center justify-center"
      >
        <Avatar>
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5 text-text-muted">{name}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logOut}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
