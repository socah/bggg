import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/components/hosting-stats', () => ({
  PersonalHostingStats: () => <p>Personal hosting statistics</p>,
}));
jest.unstable_mockModule('@/components/collection-stats', () => ({
  PersonalCollectionStats: () => <p>Personal collection statistics</p>,
}));

const { default: PersonalProfilePage } = await import('./page');

describe('PersonalProfilePage', () => {
  it('shows personal hosting statistics', () => {
    render(<PersonalProfilePage />);

    expect(screen.getByText('Personal hosting statistics')).toBeTruthy();
    expect(screen.getByText('Personal collection statistics')).toBeTruthy();
  });
});
