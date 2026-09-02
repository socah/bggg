import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server.node';

jest.unstable_mockModule('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: jest.fn() }),
}));

jest.unstable_mockModule('@/components/style-provider', () => ({
  useStyle: () => ({ style: 'tactile', setStyle: jest.fn() }),
}));

const { AppearanceSettings } = await import('./appearance-settings');

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('AppearanceSettings', () => {
  it('keeps theme buttons unpressed before mounting', () => {
    document.body.innerHTML = renderToString(<AppearanceSettings />);

    expect(screen.getByRole('button', { name: 'dark' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'light' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('exposes the selected theme and visual style as pressed buttons', () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole('button', { name: 'dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'light' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Meeple & Ink' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Marigold & Coral' }).getAttribute('aria-pressed')).toBe('false');
  });
});
