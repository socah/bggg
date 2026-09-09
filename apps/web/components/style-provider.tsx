'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Style = 'playful' | 'tactile' | 'clipart' | 'mixed' | 'comic';
const STYLES: Style[] = ['playful', 'tactile', 'clipart', 'mixed', 'comic'];
const STORAGE_KEY = 'bggg-style';
const DEFAULT_STYLE: Style = 'tactile';

interface StyleContextValue {
  style: Style;
  setStyle: (style: Style) => void;
}

const StyleContext = createContext<StyleContextValue | null>(null);

export function useStyle(): StyleContextValue {
  const ctx = useContext(StyleContext);
  if (!ctx) throw new Error('useStyle must be used within <StyleProvider>');
  return ctx;
}

// Runs before React hydrates, mirroring next-themes' own no-flash
// technique: read localStorage synchronously and stamp the attribute
// immediately so the very first paint already matches the stored
// preference instead of flashing the default style for one frame.
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var valid = ${JSON.stringify(STYLES)};
    var style = stored && valid.indexOf(stored) !== -1 ? stored : '${DEFAULT_STYLE}';
    document.documentElement.setAttribute('data-style', style);
  } catch (e) {}
})();
`;

export function StyleScript() {
  return <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />;
}

export function StyleProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<Style>(DEFAULT_STYLE);

  useEffect(() => {
    // Mount-time: adopt whatever the no-flash script already stamped
    // (or the default, if nothing was stored) into React state, so
    // future setStyle calls and any style-dependent rendering stay in
    // sync with the DOM attribute. This synchronous setState is necessary
    // to keep the DOM attribute and React state synchronized from the
    // initial mount onward; like data-fetching hooks with manual
    // fetch-in-effect, we cannot avoid it without pulling in a
    // state-management library.
    const current = document.documentElement.getAttribute('data-style');
    if (current && (STYLES as string[]).includes(current)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM attribute and React state must stay in sync from initial mount
      setStyleState(current as Style);
    }
  }, []);

  function setStyle(next: Style) {
    setStyleState(next);
    document.documentElement.setAttribute('data-style', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can throw in private-browsing/quota-exceeded cases — the
      // in-memory state above already reflects the change for this
      // session, so failing to persist just means it won't survive reload.
    }
  }

  return <StyleContext.Provider value={{ style, setStyle }}>{children}</StyleContext.Provider>;
}
