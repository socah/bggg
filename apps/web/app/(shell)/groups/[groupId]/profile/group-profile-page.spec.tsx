import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('next/navigation', () => ({
  redirect: jest.fn(),
}));

const { default: GroupProfilePage } = await import('./page');

describe('GroupProfilePage', () => {
  it('reserves the group profile for future group information', async () => {
    const page = await GroupProfilePage();
    render(page);

    expect(screen.getByText('Group profile')).toBeTruthy();
    expect(screen.getByText('Coming soon.')).toBeTruthy();
  });
});
