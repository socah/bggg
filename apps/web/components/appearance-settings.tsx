'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useStyle, type Style } from '@/components/style-provider';
import { Button } from '@/components/ui/button';

const STYLE_LABELS: Record<Style, string> = {
  playful: 'Marigold & Coral',
  tactile: 'Meeple & Ink',
  clipart: 'Starburst & Bevel',
  mixed: 'Gumdrop & Gloss',
  comic: 'Comic Sans',
};

const STYLE_ORDER: Style[] = ['playful', 'tactile', 'clipart', 'mixed', 'comic'];

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { style, setStyle } = useStyle();

  // next-themes can't know the resolved theme during SSR — `theme` is
  // undefined on the server and the real value after hydration, so deriving
  // each button's variant from it directly would produce mismatched markup.
  // Render all three theme buttons in the neutral variant until we're
  // mounted on the client, then switch to the real selection.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- "have we hydrated yet" is only knowable from an effect; the single extra render is the point.
    setMounted(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-display text-base">Theme</h3>
        <div className="mt-2 flex gap-2">
          {(['light', 'dark', 'system'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={mounted && theme === option ? 'primary' : 'secondary'}
              aria-pressed={mounted && theme === option}
              onClick={() => setTheme(option)}
              className="capitalize"
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display text-base">Style</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {STYLE_ORDER.map((option) => (
            <Button
              key={option}
              type="button"
              variant={style === option ? 'primary' : 'secondary'}
              aria-pressed={style === option}
              onClick={() => setStyle(option)}
            >
              {STYLE_LABELS[option]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
