import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/components/bgg-account-settings', () => ({
  BggAccountSettings: () => <p>BGG settings form</p>,
}));
jest.unstable_mockModule('@/components/appearance-settings', () => ({
  AppearanceSettings: () => <p>Appearance settings form</p>,
}));
jest.unstable_mockModule('@/components/calendar-feed-settings', () => ({
  CalendarFeedSettings: () => <p>Calendar settings form</p>,
}));

const { default: PersonalProfilePage } = await import('./page');

describe('PersonalProfilePage', () => {
  it('reserves the profile page for future profile information', () => {
    render(<PersonalProfilePage />);

    expect(screen.getByText('Profile')).toBeTruthy();
    expect(screen.getByText('Coming soon.')).toBeTruthy();
    expect(screen.queryByText('BoardGameGeek')).toBeNull();
    expect(screen.queryByText('Appearance')).toBeNull();
    expect(screen.queryByText('Calendar feed')).toBeNull();
  });
});
