import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

jest.unstable_mockModule('@/lib/actions', () => ({
  logOut: jest.fn(),
}));
jest.unstable_mockModule('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

const { UserMenu } = await import('./user-menu');

describe('UserMenu', () => {
  it('links account settings to the dedicated settings page', () => {
    render(<UserMenu name="Alice Example" />);

    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });
});
