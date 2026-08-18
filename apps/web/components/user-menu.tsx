'use client';

import { logOut } from '@/lib/actions';
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
      <DropdownMenuTrigger aria-label={`Account menu for ${name}`}>
        <Avatar>
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5 text-text-muted">{name}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-left">
              Log out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
