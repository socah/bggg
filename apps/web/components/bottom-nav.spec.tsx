import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

const pathname = '/groups/group-1/profile/user-2';
const push = jest.fn();
const replace = jest.fn();

jest.unstable_mockModule('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace }),
}));

const { BottomNav } = await import('./bottom-nav');

describe('BottomNav', () => {
  it('keeps selected-user navigation to collection and profile only', () => {
    render(<BottomNav />);

    expect(screen.queryByRole('button', { name: 'Calendar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collection' }));
    expect(replace).toHaveBeenCalledWith('/groups/group-1/collection/user-2');
    expect(push).not.toHaveBeenCalled();
  });
});
