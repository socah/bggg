'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useStyle } from '@/components/style-provider';

// Keeps the browser-chrome <meta name="theme-color"> in sync with
// whichever theme/style is actually active. The PWA manifest's
// theme_color is static (read once, before any JS runs, for the install
// icon/splash screen) — this is the runtime counterpart that updates the
// Android status bar color after the app has loaded and the user changes
// theme or style.
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  const { style } = useStyle();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (accent) meta.setAttribute('content', accent);
  }, [resolvedTheme, style]);

  return null;
}
