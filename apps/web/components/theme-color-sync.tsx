'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useStyle } from '@/components/style-provider';

// Keep installed-app system chrome in sync with the active theme. Android
// uses both theme-color and color-scheme when choosing its status/navigation
// bar background and icon contrast.
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  const { style } = useStyle();

  useEffect(() => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (background) {
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', background));
    }
    if (resolvedTheme === 'dark' || resolvedTheme === 'light') {
      document.documentElement.style.colorScheme = resolvedTheme;
    }
  }, [resolvedTheme, style]);

  return null;
}
