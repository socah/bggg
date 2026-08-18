# Frontend Design System + Shell Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/web` a real, switchable visual identity (5 selectable styles × light/dark) built on Tailwind v4 CSS-variable tokens, a small in-repo Radix component library, and retrofit the three existing shell components (`ViewTabs`, `GroupSwitcher`, `ProposalDetailPanel`) onto it — plus split the shell into a desktop top-nav / mobile bottom-nav layout.

**Architecture:** Two independent runtime-switchable axes (`data-style`, `data-theme`) on `<html>`, each a set of CSS custom properties consumed through a Tailwind v4 `@theme inline` mapping. `next-themes` owns the theme axis; a small hand-rolled `StyleProvider` (same no-flash-script technique) owns the style axis. Every component reads tokens via Tailwind utility classes (`bg-bg`, `text-text`, `font-display`, ...); the handful of composite "signature" values that don't map to a Tailwind namespace (`--shadow-card`, `--rule-border`, `--tab-indicator`, `--badge-rotate`, `--border-w`) are applied via inline `style` or Tailwind arbitrary-property syntax in the small number of components that need them.

**Tech Stack:** Next.js 16 (App Router, React 19), Tailwind v4, `next-themes`, Radix UI primitives (`@radix-ui/react-{tabs,dropdown-menu,dialog,avatar,slot}`), `class-variance-authority`, `clsx` + `tailwind-merge`.

**Spec:** `docs/superpowers/specs/2026-08-18-frontend-design-system-design.md`

## Global Constraints

- No new test infrastructure. `apps/web` has none today (`docs/reference/frontend-architecture.md`). Every task's "test cycle" is: `npm run build --workspace=apps/web` (typecheck + production build) and `npm run lint --workspace=apps/web`, plus a concrete manual dev-server check described in the task.
- Playful ("Marigold & Coral") is the default style and corresponds to **no `data-style` attribute at all** — never write code that requires the attribute to be explicitly `"playful"`.
- Every color, font, radius, and shadow a component uses must come from the token layer (Tailwind utilities backed by `@theme inline`, or the raw CSS variables for the few composite values) — never a literal Tailwind color like `bg-gray-50` or a hardcoded hex.
- All interactive nav/tab targets are at least 44px in the smallest dimension (Tailwind's `11` spacing step = 2.75rem = 44px).
- `components/ui/*` own their Radix-wrapping code in-repo (the shadcn convention) — Radix is a peer dependency of these files, never imported directly into feature components.
- `apps/web/lib/space.ts`'s `parseSpacePath`/`spaceHref` remain the single source of truth for shell navigation; no task changes their signatures.

---

### Task 1: Add dependencies

**Files:**
- Modify: `apps/web/package.json` (via `npm install`, not hand-edited)
- Modify: `package-lock.json` (repo root — this is an npm workspaces monorepo, one lockfile)

**Interfaces:**
- Produces: `next-themes`, `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-tabs`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`, `@radix-ui/react-avatar`, `@radix-ui/react-slot` available to import from every later task.

- [ ] **Step 1: Install the new dependencies**

Run from the repo root (`/workspaces/bggg`):

```bash
npm install --workspace=apps/web next-themes clsx tailwind-merge class-variance-authority @radix-ui/react-tabs @radix-ui/react-dropdown-menu @radix-ui/react-dialog @radix-ui/react-avatar @radix-ui/react-slot
```

- [ ] **Step 2: Verify the workspace still builds**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds unchanged (nothing imports the new packages yet) — this only confirms the install didn't break resolution.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json apps/web/package.json
git commit -m "Add design-system dependencies (next-themes, Radix primitives, cva)"
```

---

### Task 2: Design tokens in `globals.css` + Tailwind `@theme inline` mapping

**Files:**
- Modify: `apps/web/app/globals.css` (full rewrite)
- Modify: `apps/web/app/layout.tsx:12-42` (viewport color + body className only — no other changes yet)

**Interfaces:**
- Produces: CSS custom properties `--bg`, `--surface`, `--surface-raised`, `--text`, `--text-muted`, `--border`, `--border-strong`, `--accent`, `--accent-ink`, `--accent-2`, `--accent-2-ink`, `--highlight`, `--muted-tone`, `--shadow`, `--font-display-face`, `--font-body-face`, `--font-mono-face`, `--radius-token-sm`, `--radius-token-md`, `--border-w`, `--shadow-card`, `--rule-border`, `--tab-indicator`, `--badge-rotate` — scoped by `[data-style]` × `[data-theme]`. Produces Tailwind utilities: `bg-bg`, `bg-surface`, `bg-surface-raised`, `text-text`, `text-text-muted`, `border-border`, `border-border-strong`, `bg-accent`/`text-accent`, `text-accent-ink`, `bg-accent-2`/`text-accent-2`, `text-accent-2-ink`, `bg-highlight`/`text-highlight`, `text-muted-tone`, `font-display`, `font-body`, `font-mono`, `rounded-sm`, `rounded-md`.
- Consumes: nothing (this is the foundation every later task builds on).

This is the task the spec's first Risk calls out explicitly — validate the `@theme inline` + runtime-`var()` mechanism actually works before building anything on top of it.

- [ ] **Step 1: Write the full token file**

Replace the entire contents of `apps/web/app/globals.css` with:

```css
@import "tailwindcss";

/* ============================================================
   Design tokens — five selectable "styles" (visual identities)
   crossed with light/dark "theme". Two independent attributes on
   <html>: data-style (playful [default, no attribute] | tactile |
   clipart | mixed | comic) and data-theme (light | dark, resolved
   by next-themes — see components/theme-provider.tsx).

   Every block below sets the same fixed set of raw custom
   properties. @theme inline (further down) is the only place that
   maps them into real Tailwind utilities, so feature components
   never reference --bg/--accent/etc. by their raw names directly,
   except for the handful of "signature" values (--shadow-card,
   --rule-border, --tab-indicator, --badge-rotate, --border-w) that
   don't correspond to a Tailwind theme namespace and are applied
   via inline style or arbitrary-property utilities in the small
   number of components that need them.
   ============================================================ */

:root {
  /* Marigold & Coral — the default style, light */
  --bg: #FFF3E0;
  --surface: #FFFAF0;
  --surface-raised: #FFFFFF;
  --text: #3B2A34;
  --text-muted: #8C5B45;
  --border: rgba(59, 42, 52, 0.18);
  --border-strong: rgba(59, 42, 52, 0.4);
  --accent: #E1553A;
  --accent-ink: #FFFFFF;
  --accent-2: #2E8B84;
  --accent-2-ink: #FFFFFF;
  --highlight: #F4B942;
  --muted-tone: #8C5B45;
  --shadow: rgba(59, 42, 52, 0.22);

  --font-display-face: 'Fredoka', ui-rounded, sans-serif;
  --font-body-face: 'Nunito', ui-sans-serif, system-ui, sans-serif;
  --font-mono-face: 'Space Mono', ui-monospace, monospace;
  --radius-token-sm: 12px;
  --radius-token-md: 18px;
  --border-w: 2px;
  --shadow-card: 3px 3px 0 var(--border-strong);
  --rule-border: 4px solid var(--accent);
  --tab-indicator: 4px solid var(--accent);
  --badge-rotate: -3deg;
}

[data-style="tactile"] {
  /* Meeple & Ink — grounded, heritage-tactile */
  --bg: #F6F0DE;
  --surface: #FBF7EC;
  --surface-raised: #FFFDF6;
  --text: #2B2622;
  --text-muted: #7A6A50;
  --border: rgba(43, 38, 34, 0.15);
  --border-strong: rgba(43, 38, 34, 0.28);
  --accent: #C1443B;
  --accent-ink: #FFFFFF;
  --accent-2: #3F6B4E;
  --accent-2-ink: #FFFFFF;
  --highlight: #DFA23A;
  --muted-tone: #6B5642;
  --shadow: rgba(43, 38, 34, 0.10);

  --font-display-face: 'Fraunces', Georgia, serif;
  --font-body-face: 'Karla', ui-sans-serif, system-ui, sans-serif;
  --font-mono-face: 'IBM Plex Mono', ui-monospace, monospace;
  --radius-token-sm: 8px;
  --radius-token-md: 10px;
  --border-w: 1px;
  --shadow-card: 0 1px 2px var(--shadow);
  --rule-border: 2px dotted var(--border-strong);
  --tab-indicator: 2px dotted var(--accent);
  --badge-rotate: 0deg;
}

[data-style="clipart"] {
  /* Starburst & Bevel — 90s CD-ROM chic */
  --bg: #F3EFFB;
  --surface: #FFFFFF;
  --surface-raised: #FFFFFF;
  --text: #2B2140;
  --text-muted: #6E6091;
  --border: rgba(43, 33, 64, 0.25);
  --border-strong: rgba(43, 33, 64, 0.45);
  --accent: #C2126B;
  --accent-ink: #FFFFFF;
  --accent-2: #1B4FCC;
  --accent-2-ink: #FFFFFF;
  --highlight: #F4B400;
  --muted-tone: #8B7FB0;
  --shadow: rgba(43, 33, 64, 0.25);

  --font-display-face: 'Titan One', 'Baloo 2', cursive, sans-serif;
  --font-body-face: 'Rubik', ui-sans-serif, system-ui, sans-serif;
  --font-mono-face: 'Share Tech Mono', ui-monospace, monospace;
  --radius-token-sm: 10px;
  --radius-token-md: 14px;
  --border-w: 2px;
  --shadow-card: inset 1px 1px 0 rgba(255, 255, 255, 0.6), inset -1px -1px 0 rgba(0, 0, 0, 0.18), 2px 3px 4px var(--shadow);
  --rule-border: 2px solid rgba(0, 0, 0, 0.25);
  --tab-indicator: 3px solid var(--accent);
  --badge-rotate: 0deg;
}

[data-style="mixed"] {
  /* Gumdrop & Gloss — Playful x Bevel */
  --bg: #FBEDF0;
  --surface: #FFF8FA;
  --surface-raised: #FFFFFF;
  --text: #33253A;
  --text-muted: #8B6B8A;
  --border: rgba(51, 37, 58, 0.2);
  --border-strong: rgba(51, 37, 58, 0.4);
  --accent: #D93F6B;
  --accent-ink: #FFFFFF;
  --accent-2: #1E7FB8;
  --accent-2-ink: #FFFFFF;
  --highlight: #F4B942;
  --muted-tone: #8B6B8A;
  --shadow: rgba(51, 37, 58, 0.28);

  --font-display-face: 'Baloo 2', ui-rounded, sans-serif;
  --font-body-face: 'Quicksand', ui-sans-serif, system-ui, sans-serif;
  --font-mono-face: 'Space Mono', ui-monospace, monospace;
  --radius-token-sm: 12px;
  --radius-token-md: 16px;
  --border-w: 2px;
  --shadow-card: 2px 3px 0 var(--border-strong), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  --rule-border: 4px solid var(--accent);
  --tab-indicator: 4px solid var(--accent);
  --badge-rotate: -2deg;
}

[data-style="comic"] {
  /* Comic Sans — the joke option, kept for real as a selectable theme */
  --bg: #FFFFFF;
  --surface: #F2F2F2;
  --surface-raised: #FFFFFF;
  --text: #000000;
  --text-muted: #555555;
  --border: #000000;
  --border-strong: #000000;
  --accent: #E10600;
  --accent-ink: #FFFFFF;
  --accent-2: #0645AD;
  --accent-2-ink: #FFFFFF;
  --highlight: #FFEB3B;
  --muted-tone: #808080;
  --shadow: rgba(225, 6, 0, 0.35);

  --font-display-face: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
  --font-body-face: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
  --font-mono-face: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
  --radius-token-sm: 0px;
  --radius-token-md: 0px;
  --border-w: 3px;
  --shadow-card: 3px 3px 0 #000, 6px 6px 0 var(--shadow);
  --rule-border: 5px dashed var(--border-strong);
  --tab-indicator: 4px solid var(--accent);
  --badge-rotate: -8deg;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-style="tactile"]):not([data-style="clipart"]):not([data-style="mixed"]):not([data-style="comic"]) {
    --bg: #241A22;
    --surface: #2E2129;
    --surface-raised: #362732;
    --text: #FBEEE0;
    --text-muted: #CBA98F;
    --border: rgba(251, 238, 224, 0.14);
    --border-strong: rgba(251, 238, 224, 0.3);
    --accent: #FF8269;
    --accent-ink: #241A22;
    --accent-2: #57B3AA;
    --accent-2-ink: #241A22;
    --highlight: #FFCB61;
    --muted-tone: #D8BCA2;
    --shadow: rgba(0, 0, 0, 0.5);
  }
  [data-style="tactile"]:not([data-theme="light"]) {
    --bg: #1C1815;
    --surface: #242019;
    --surface-raised: #2B251F;
    --text: #F0EAD9;
    --text-muted: #B9A98A;
    --border: rgba(240, 234, 217, 0.14);
    --border-strong: rgba(240, 234, 217, 0.26);
    --accent: #E06B62;
    --accent-ink: #1C1815;
    --accent-2: #6FA383;
    --accent-2-ink: #1C1815;
    --highlight: #E8B563;
    --muted-tone: #C7B491;
    --shadow: rgba(0, 0, 0, 0.35);
  }
  [data-style="clipart"]:not([data-theme="light"]) {
    --bg: #150F24;
    --surface: #1E1638;
    --surface-raised: #241B40;
    --text: #F0EAFF;
    --text-muted: #B3A6D9;
    --border: rgba(240, 234, 255, 0.16);
    --border-strong: rgba(240, 234, 255, 0.3);
    --accent: #FF4FA3;
    --accent-ink: #150F24;
    --accent-2: #4C8DFF;
    --accent-2-ink: #150F24;
    --highlight: #FFD54A;
    --muted-tone: #7A6BA3;
    --shadow: rgba(0, 0, 0, 0.5);
  }
  [data-style="mixed"]:not([data-theme="light"]) {
    --bg: #241627;
    --surface: #2E1D33;
    --surface-raised: #38263D;
    --text: #FBEAF0;
    --text-muted: #D8A9C9;
    --border: rgba(251, 234, 240, 0.16);
    --border-strong: rgba(251, 234, 240, 0.32);
    --accent: #FF6B94;
    --accent-ink: #241627;
    --accent-2: #4FB6E8;
    --accent-2-ink: #241627;
    --highlight: #FFCE5C;
    --muted-tone: #D8A9C9;
    --shadow: rgba(0, 0, 0, 0.5);
  }
  [data-style="comic"]:not([data-theme="light"]) {
    --bg: #000000;
    --surface: #0A0A0A;
    --surface-raised: #111111;
    --text: #39FF14;
    --text-muted: #66FF99;
    --border: #39FF14;
    --border-strong: #39FF14;
    --accent: #FF3355;
    --accent-ink: #000000;
    --accent-2: #33CCFF;
    --accent-2-ink: #000000;
    --highlight: #FFFF33;
    --muted-tone: #66FF99;
    --shadow: rgba(51, 204, 255, 0.35);
  }
}

:root[data-theme="dark"]:not([data-style="tactile"]):not([data-style="clipart"]):not([data-style="mixed"]):not([data-style="comic"]) {
  --bg: #241A22;
  --surface: #2E2129;
  --surface-raised: #362732;
  --text: #FBEEE0;
  --text-muted: #CBA98F;
  --border: rgba(251, 238, 224, 0.14);
  --border-strong: rgba(251, 238, 224, 0.3);
  --accent: #FF8269;
  --accent-ink: #241A22;
  --accent-2: #57B3AA;
  --accent-2-ink: #241A22;
  --highlight: #FFCB61;
  --muted-tone: #D8BCA2;
  --shadow: rgba(0, 0, 0, 0.5);
}
[data-style="tactile"][data-theme="dark"] {
  --bg: #1C1815;
  --surface: #242019;
  --surface-raised: #2B251F;
  --text: #F0EAD9;
  --text-muted: #B9A98A;
  --border: rgba(240, 234, 217, 0.14);
  --border-strong: rgba(240, 234, 217, 0.26);
  --accent: #E06B62;
  --accent-ink: #1C1815;
  --accent-2: #6FA383;
  --accent-2-ink: #1C1815;
  --highlight: #E8B563;
  --muted-tone: #C7B491;
  --shadow: rgba(0, 0, 0, 0.35);
}
[data-style="clipart"][data-theme="dark"] {
  --bg: #150F24;
  --surface: #1E1638;
  --surface-raised: #241B40;
  --text: #F0EAFF;
  --text-muted: #B3A6D9;
  --border: rgba(240, 234, 255, 0.16);
  --border-strong: rgba(240, 234, 255, 0.3);
  --accent: #FF4FA3;
  --accent-ink: #150F24;
  --accent-2: #4C8DFF;
  --accent-2-ink: #150F24;
  --highlight: #FFD54A;
  --muted-tone: #7A6BA3;
  --shadow: rgba(0, 0, 0, 0.5);
}
[data-style="mixed"][data-theme="dark"] {
  --bg: #241627;
  --surface: #2E1D33;
  --surface-raised: #38263D;
  --text: #FBEAF0;
  --text-muted: #D8A9C9;
  --border: rgba(251, 234, 240, 0.16);
  --border-strong: rgba(251, 234, 240, 0.32);
  --accent: #FF6B94;
  --accent-ink: #241627;
  --accent-2: #4FB6E8;
  --accent-2-ink: #241627;
  --highlight: #FFCE5C;
  --muted-tone: #D8A9C9;
  --shadow: rgba(0, 0, 0, 0.5);
}
[data-style="comic"][data-theme="dark"] {
  --bg: #000000;
  --surface: #0A0A0A;
  --surface-raised: #111111;
  --text: #39FF14;
  --text-muted: #66FF99;
  --border: #39FF14;
  --border-strong: #39FF14;
  --accent: #FF3355;
  --accent-ink: #000000;
  --accent-2: #33CCFF;
  --accent-2-ink: #000000;
  --highlight: #FFFF33;
  --muted-tone: #66FF99;
  --shadow: rgba(51, 204, 255, 0.35);
}

/* Maps the raw runtime tokens above into real Tailwind utilities
   (bg-bg, text-text, bg-accent, font-display, rounded-md, ...).
   `inline` tells Tailwind to keep referencing these variables at
   runtime instead of resolving them to a fixed value at build time —
   required for them to actually change when data-style/data-theme
   change. */
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-2: var(--accent-2);
  --color-accent-2-ink: var(--accent-2-ink);
  --color-highlight: var(--highlight);
  --color-muted-tone: var(--muted-tone);

  --font-display: var(--font-display-face);
  --font-body: var(--font-body-face);
  --font-mono: var(--font-mono-face);

  --radius-sm: var(--radius-token-sm);
  --radius-md: var(--radius-token-md);
}

@layer base {
  h1, h2, h3, h4 {
    font-family: var(--font-display);
  }
}
```

- [ ] **Step 2: Point the root layout's body and viewport color at the new tokens**

In `apps/web/app/layout.tsx`, change:

```tsx
export const viewport: Viewport = {
  themeColor: '#4f46e5',
};
```

to:

```tsx
export const viewport: Viewport = {
  themeColor: '#E1553A',
};
```

and change:

```tsx
<body className="min-h-screen bg-gray-50 text-gray-900">
```

to:

```tsx
<body className="min-h-screen bg-bg text-text font-body">
```

- [ ] **Step 3: Verify the build picks up the new CSS**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds. If `@theme inline` or any selector is malformed, Tailwind's build step fails here — this is the concrete signal the spec's Risk section calls for.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev --workspace=apps/web` (from repo root, via the existing `dev:web` script or directly in `apps/web`), open the app in a browser.
Expected: the page background is warm cream (`#FFF3E0` light / `#241A22` dark depending on OS preference), not gray — this is the first visible proof the token pipeline works end to end. Body text uses Nunito (or its fallback if the font hasn't loaded from Google Fonts yet — that's addressed later; the important check here is the *color*, not the font).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/globals.css apps/web/app/layout.tsx
git commit -m "Add design-system tokens (5 styles x light/dark) via Tailwind v4 @theme inline"
```

---

### Task 3: `lib/cn.ts` + base primitives (Button, Badge, Card, Input)

**Files:**
- Create: `apps/web/lib/cn.ts`
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/badge.tsx`
- Create: `apps/web/components/ui/card.tsx`
- Create: `apps/web/components/ui/input.tsx`

**Interfaces:**
- Consumes: Tailwind utilities from Task 2 (`bg-accent`, `text-accent-ink`, `font-body`, `rounded-sm`, etc.) and raw vars `--shadow-card`, `--badge-rotate`, `--border-w`.
- Produces: `cn(...)` helper; `Button` (`variant: 'primary' | 'secondary' | 'ghost'`, `asChild?: boolean`, forwards a ref); `Badge`; `Card`; `Input` (forwards a ref) — all consumed by Tasks 6-13.

- [ ] **Step 1: `lib/cn.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: `components/ui/button.tsx`**

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 font-body text-sm font-semibold rounded-sm min-h-11 px-4 transition-colors disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink',
        secondary: 'bg-transparent text-accent-2 border-[length:var(--border-w)] border-accent-2',
        ghost: 'bg-transparent text-text-muted',
      },
    },
    defaultVariants: { variant: 'primary' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild, style, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant }), className)}
        style={{ boxShadow: 'var(--shadow-card)', ...style }}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
```

- [ ] **Step 3: `components/ui/badge.tsx`**

```tsx
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Badge({ className, style, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm bg-highlight px-2 py-0.5 font-mono text-xs font-medium text-text',
        className
      )}
      style={{ transform: 'rotate(var(--badge-rotate))', ...style }}
      {...props}
    />
  );
}
```

- [ ] **Step 4: `components/ui/card.tsx`**

```tsx
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface border-[length:var(--border-w)] border-border overflow-hidden',
        className
      )}
      style={{ boxShadow: 'var(--shadow-card)', ...style }}
      {...props}
    />
  );
}
```

- [ ] **Step 5: `components/ui/input.tsx`**

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised px-2 py-1.5 font-body text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
```

- [ ] **Step 6: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass. Nothing renders these yet (no consumer exists until Task 6+) — this step only confirms the four files typecheck and satisfy lint, including `class-variance-authority`'s generic types.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/cn.ts apps/web/components/ui/button.tsx apps/web/components/ui/badge.tsx apps/web/components/ui/card.tsx apps/web/components/ui/input.tsx
git commit -m "Add cn() helper and base UI primitives (Button, Badge, Card, Input)"
```

---

### Task 4: Style axis — `StyleProvider` + no-flash script

**Files:**
- Create: `apps/web/components/style-provider.tsx`
- Modify: `apps/web/app/providers.tsx` (wrap with `StyleProvider`)
- Modify: `apps/web/app/layout.tsx` (render `<StyleScript />`)

**Interfaces:**
- Produces: `Style` type (`'playful' | 'tactile' | 'clipart' | 'mixed' | 'comic'`), `useStyle()` hook returning `{ style: Style; setStyle: (s: Style) => void }`, `StyleProvider`, `StyleScript` — consumed by Task 5 (`ThemeColorSync`) and Task 13 (`AppearanceSettings`).
- Consumes: nothing new.

- [ ] **Step 1: `components/style-provider.tsx`**

```tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Style = 'playful' | 'tactile' | 'clipart' | 'mixed' | 'comic';
const STYLES: Style[] = ['playful', 'tactile', 'clipart', 'mixed', 'comic'];
const STORAGE_KEY = 'bggg-style';
const DEFAULT_STYLE: Style = 'playful';

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
    if (stored && valid.indexOf(stored) !== -1 && stored !== '${DEFAULT_STYLE}') {
      document.documentElement.setAttribute('data-style', stored);
    }
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
    // sync with the DOM attribute.
    const current = document.documentElement.getAttribute('data-style');
    if (current && (STYLES as string[]).includes(current)) {
      setStyleState(current as Style);
    }
  }, []);

  function setStyle(next: Style) {
    setStyleState(next);
    if (next === DEFAULT_STYLE) {
      document.documentElement.removeAttribute('data-style');
    } else {
      document.documentElement.setAttribute('data-style', next);
    }
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
```

- [ ] **Step 2: Wrap `Providers` with `StyleProvider`**

Replace `apps/web/app/providers.tsx` entirely with:

```tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { StyleProvider } from '@/components/style-provider';

// Auth.js's client helpers (getSession, signOut, useSession) read their
// base path from this provider's config at mount time — auth.ts sets
// basePath: '/web/auth' server-side, so this has to match, or client calls
// silently target the wrong (nonexistent, since '/api' is unconditionally
// the NestJS backend) route.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/web/auth">
      <StyleProvider>{children}</StyleProvider>
    </SessionProvider>
  );
}
```

(Task 5 wraps this again with `ThemeProvider` — this step intentionally leaves that out so this task is testable on its own.)

- [ ] **Step 3: Render the no-flash script in the root layout**

In `apps/web/app/layout.tsx`, add the import and render `<StyleScript />` as the first child of `<body>`:

```tsx
import { StyleScript } from '@/components/style-provider';
```

```tsx
<body className="min-h-screen bg-bg text-text font-body">
  <StyleScript />
  <Providers>{children}</Providers>
</body>
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass.

- [ ] **Step 5: Manual no-flash check**

With the dev server running, open browser devtools console and run:

```js
localStorage.setItem('bggg-style', 'tactile');
```

Then reload the page.
Expected: the page background is `#F6F0DE` (Tactile's cream) from the very first paint — no flash of the Playful orange/cream before it switches. Confirm `document.documentElement.getAttribute('data-style')` returns `'tactile'` in the console. Then run `localStorage.removeItem('bggg-style')` and reload — confirm it's back to Playful with no `data-style` attribute at all.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/style-provider.tsx apps/web/app/providers.tsx apps/web/app/layout.tsx
git commit -m "Add StyleProvider for the 5-way style axis with no-flash persistence"
```

---

### Task 5: Theme axis — `next-themes` + runtime theme-color sync

**Files:**
- Create: `apps/web/components/theme-provider.tsx`
- Create: `apps/web/components/theme-color-sync.tsx`
- Modify: `apps/web/app/providers.tsx` (wrap with `ThemeProvider`, render `ThemeColorSync`)
- Modify: `apps/web/app/layout.tsx` (`<html suppressHydrationWarning>`)

**Interfaces:**
- Consumes: `useStyle()` from Task 4.
- Produces: `ThemeProvider` (wraps `next-themes`, `attribute="data-theme"`, `defaultTheme="system"`, `enableSystem`); `ThemeColorSync` (no props, renders nothing) — consumed by Task 13 (`useTheme()` from `next-themes` directly).

- [ ] **Step 1: `components/theme-provider.tsx`**

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: `components/theme-color-sync.tsx`**

```tsx
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
```

- [ ] **Step 3: Finalize `providers.tsx`**

Replace `apps/web/app/providers.tsx` with:

```tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from '@/components/theme-provider';
import { StyleProvider } from '@/components/style-provider';
import { ThemeColorSync } from '@/components/theme-color-sync';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/web/auth">
      <ThemeProvider>
        <StyleProvider>
          <ThemeColorSync />
          {children}
        </StyleProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
```

- [ ] **Step 4: Suppress the expected hydration warning**

`next-themes` sets `data-theme` on `<html>` before React hydrates, which otherwise triggers a benign client/server mismatch warning — `suppressHydrationWarning` on that one element is the documented fix. In `apps/web/app/layout.tsx`, change:

```tsx
<html lang="en">
```

to:

```tsx
<html lang="en" suppressHydrationWarning>
```

- [ ] **Step 5: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass, no hydration-warning noise in the dev server console on load.

- [ ] **Step 6: Manual dark-mode check**

With the dev server running, open devtools → Rendering tab → set "Emulate CSS media feature prefers-color-scheme" to `dark`.
Expected: background flips to `#241A22`, text to `#FBEEE0` (Playful dark). Inspect `<meta name="theme-color">` in the Elements panel — its `content` attribute should now read `#FF8269` (Playful dark's accent), not the light-mode `#E1553A`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/theme-provider.tsx apps/web/components/theme-color-sync.tsx apps/web/app/providers.tsx apps/web/app/layout.tsx
git commit -m "Wire next-themes for the light/dark axis with runtime theme-color sync"
```

---

### Task 6: `ui/tabs.tsx` + `ViewTabs` retrofit

**Files:**
- Create: `apps/web/components/ui/tabs.tsx`
- Modify: `apps/web/components/view-tabs.tsx` (full rewrite)

**Interfaces:**
- Consumes: `cn` (Task 3); `parseSpacePath`, `spaceHref`, `ViewTab` (existing, unchanged, `apps/web/lib/space.ts`).
- Produces: `Tabs`, `TabsList`, `TabsTrigger` — not consumed elsewhere in this plan, but this is the pattern any future feature's own tab strip should follow.

**Known tradeoff:** Radix `Tabs.Trigger` renders a `<button>`, not an `<a>`. Middle-click/"open in new tab" on a tab stops working (it didn't have real ARIA tab semantics before either — this trades that one interaction for correct `role="tab"`/keyboard-arrow navigation, which the spec calls out as a real gap being fixed, not just restyled).

- [ ] **Step 1: `components/ui/tabs.tsx`**

```tsx
'use client';

import { forwardRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex gap-4 font-body text-sm font-medium', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative pb-2 pt-1 text-text-muted data-[state=active]:font-semibold data-[state=active]:text-text data-[state=active]:[border-bottom:var(--tab-indicator)]',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';
```

- [ ] **Step 2: Rewrite `ViewTabs` as a controlled Radix `Tabs`**

Replace `apps/web/components/view-tabs.tsx` entirely with:

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

export function ViewTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <Tabs value={activeTab} onValueChange={(next) => router.push(spaceHref(groupId, next as ViewTab))}>
      <TabsList aria-label="Sections">
        {TABS.map(({ tab, label }) => (
          <TabsTrigger key={tab} value={tab}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

Note: `ViewTabs` isn't rendered anywhere yet in a way that's visible (Task 12 wires it into the shell) — but it *is* still imported by nothing right now since `ShellLayout` hasn't changed. Skip straight to Step 3's build check; the visual check for this component happens in Task 12.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass. (`ShellLayout` still imports the old `ViewTabs` export name, which is unchanged, so this compiles against the existing shell without any other file needing changes yet.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/tabs.tsx apps/web/components/view-tabs.tsx
git commit -m "Retrofit ViewTabs onto Radix Tabs with real ARIA and the tab-indicator signature"
```

---

### Task 7: `ui/dropdown-menu.tsx` + `GroupSwitcher` retrofit

**Files:**
- Create: `apps/web/components/ui/dropdown-menu.tsx`
- Modify: `apps/web/components/group-switcher.tsx` (full rewrite)

**Interfaces:**
- Consumes: `cn` (Task 3), `Button`, `Input` (Task 3), `apiFetch` / `parseSpacePath` / `spaceHref` / `Group` (existing, unchanged).
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` — reused by Task 9 (`UserMenu`).

- [ ] **Step 1: `components/ui/dropdown-menu.tsx`**

```tsx
'use client';

import { forwardRef } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-48 rounded-md border-[length:var(--border-w)] border-border bg-surface-raised p-1 font-body text-sm',
        className
      )}
      style={{ boxShadow: 'var(--shadow-card)' }}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'cursor-pointer rounded-sm px-2 py-1.5 text-text outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-ink',
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 border-t border-border', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
```

- [ ] **Step 2: Rewrite `GroupSwitcher`**

Replace `apps/web/components/group-switcher.tsx` entirely with:

```tsx
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { parseSpacePath, spaceHref } from '@/lib/space';
import type { Group } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function GroupSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId: activeGroupId, tab } = parseSpacePath(pathname);

  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/groups')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load groups');
        return res.json();
      })
      .then((data: Group[]) => {
        if (!cancelled) setGroups(data);
      })
      .catch(() => {
        // Keep whatever list was already loaded (possibly empty on first
        // load) rather than clearing it — group-switcher failures
        // shouldn't block navigation.
        if (!cancelled) setError('Could not load groups');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    if (!newGroupName.trim()) return;

    try {
      const response = await apiFetch('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName }),
      });
      if (!response.ok) {
        setError('Could not create group');
        return;
      }
      const created: Group = await response.json();
      setGroups((prev) => [...prev, created]);
      setNewGroupName('');
      setCreating(false);
      setError(null);
      router.push(spaceHref(created.id, tab));
    } catch {
      // apiFetch itself throws when the session is dead (it already
      // triggers a sign-out redirect in that case) — nothing more to show
      // the user here, but don't let it become an unhandled rejection.
      setError('Could not create group');
    }
  }

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const activeLabel = activeGroup ? (activeGroup.isSolo ? 'Just Me' : activeGroup.name) : 'Personal (all groups)';

  return (
    <DropdownMenu onOpenChange={(open) => !open && setCreating(false)}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" aria-label="Select group">
          {activeLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => router.push(spaceHref(null, tab))}>
          Personal (all groups)
        </DropdownMenuItem>
        {groups.map((group) => (
          <DropdownMenuItem key={group.id} onSelect={() => router.push(spaceHref(group.id, tab))}>
            {group.isSolo ? 'Just Me' : group.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {creating ? (
          <form onSubmit={handleCreateGroup} className="flex gap-1 p-1" onClick={(event) => event.stopPropagation()}>
            <Input
              autoFocus
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="New group name"
              className="w-32 text-xs"
            />
            <Button type="submit" variant="ghost" className="px-2 text-xs">
              Add
            </Button>
          </form>
        ) : (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreating(true);
            }}
          >
            + New group
          </DropdownMenuItem>
        )}
        {error && <p className="px-2 py-1 text-xs text-accent">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`onSelect={(event) => { event.preventDefault(); setCreating(true); }}` deliberately prevents Radix's default "close the menu on select" behavior for that one item, since selecting "+ New group" should reveal the inline form *inside* the still-open menu, not close it.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass.

- [ ] **Step 4: Manual check**

With the dev server running and logged in: click the group switcher button — a dropdown opens listing "Personal (all groups)" plus every group, selecting one navigates and preserves the current tab (parity with the old `<select>`). Click "+ New group" — an inline text input appears *without the dropdown closing*; typing a name and submitting creates the group and navigates into it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/dropdown-menu.tsx apps/web/components/group-switcher.tsx
git commit -m "Retrofit GroupSwitcher from a native <select> onto Radix DropdownMenu"
```

---

### Task 8: `ui/dialog.tsx` + `ProposalDetailPanel` retrofit

**Files:**
- Create: `apps/web/components/ui/dialog.tsx`
- Modify: `apps/web/components/proposal-detail-panel.tsx` (full rewrite)

**Interfaces:**
- Consumes: `cn` (Task 3), `Badge` (Task 3), `useProposalDetail` / `useGroupMembers` (existing, unchanged).
- Produces: `Dialog`, `DialogTrigger`, `DialogClose`, `DialogTitle`, `DialogOverlay`, `DialogSheetContent` — the side-sheet variant is the one this plan needs; a centered `DialogContent` isn't built since nothing in this plan needs one yet.

This fixes a real gap, not just a style one: the current panel is a bare `fixed` div with no backdrop, no focus trap, and no portal.

- [ ] **Step 1: `components/ui/dialog.tsx`**

```tsx
'use client';

import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;

export const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-40 bg-black/40', className)} {...props} />
));
DialogOverlay.displayName = 'DialogOverlay';

// A right-side sheet, not a centered modal — apps/web's proposal detail
// panel has always been a slide-over; this keeps that positioning while
// gaining Radix's focus trap / Escape-to-close / backdrop for free.
export const DialogSheetContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn('fixed inset-y-0 right-0 z-50 w-80 overflow-y-auto bg-surface-raised p-4', className)}
      style={{ borderLeft: 'var(--border-w) solid var(--border)', boxShadow: 'var(--shadow-card)' }}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogSheetContent.displayName = 'DialogSheetContent';
```

- [ ] **Step 2: Rewrite `ProposalDetailPanel`**

Replace `apps/web/components/proposal-detail-panel.tsx` entirely with:

```tsx
'use client';

import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface ProposalDetailPanelProps {
  proposalId: string | null;
  onClose: () => void;
}

export function ProposalDetailPanel({ proposalId, onClose }: ProposalDetailPanelProps) {
  const { detail, loading, notFound, error, retry } = useProposalDetail(proposalId);
  const members = useGroupMembers(detail?.proposal.groupId ?? null);

  function nameFor(userId: string): string {
    return members.find((m) => m.id === userId)?.displayName ?? userId;
  }

  return (
    <Dialog open={proposalId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogSheetContent aria-describedby={undefined}>
        <DialogTitle className="sr-only">Proposal details</DialogTitle>
        <DialogClose className="mb-2 text-sm text-text-muted">Close ✕</DialogClose>

        {loading && <p>Loading…</p>}
        {notFound && <p>This item is no longer available.</p>}
        {error && (
          <p className="text-accent">
            {error}{' '}
            <button type="button" onClick={retry} className="underline">
              Retry
            </button>
          </p>
        )}

        {detail && (
          <div className="space-y-3 font-body text-sm">
            <div>
              <div className="font-display text-base">{detail.proposal.proposedDate}</div>
              <div className="text-text-muted">Status: {detail.proposal.status}</div>
              <div className="text-text-muted">Proposed by: {nameFor(detail.proposal.createdBy)}</div>
              {detail.proposal.hostId && (
                <div className="text-text-muted">Host: {nameFor(detail.proposal.hostId)}</div>
              )}
            </div>

            <div>
              <div className="font-medium">RSVPs</div>
              <ul>
                {detail.rsvps.map((rsvp) => (
                  <li key={rsvp.userId}>
                    {nameFor(rsvp.userId)} — {rsvp.status}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="font-medium">Suggested games</div>
              <ul className="flex flex-col gap-1">
                {detail.games.map(({ game, voteCount }) => (
                  <li key={game.id} className="flex items-center gap-2">
                    {game.name}
                    <Badge>
                      {voteCount} vote{voteCount === 1 ? '' : 's'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogSheetContent>
    </Dialog>
  );
}
```

`aria-describedby={undefined}` suppresses Radix's dev-only warning about a missing description (there's no separate description text here — the content itself is the description); `DialogTitle` is real, just visually hidden (`sr-only`), which satisfies the actual accessibility requirement Radix is warning about in the first place.

- [ ] **Step 3: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass.

- [ ] **Step 4: Manual check**

Open a proposal from the calendar view. Expected, versus the old panel: a backdrop appears behind it; pressing `Escape` closes it; clicking the backdrop closes it; focus visibly moves into the panel on open and returns to whatever was focused before (e.g. the calendar cell) on close — none of this existed before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/dialog.tsx apps/web/components/proposal-detail-panel.tsx
git commit -m "Retrofit ProposalDetailPanel onto Radix Dialog as a focus-trapped side-sheet"
```

---

### Task 9: `ui/avatar.tsx` + `lib/actions.ts` + `UserMenu`

**Files:**
- Create: `apps/web/components/ui/avatar.tsx`
- Create: `apps/web/lib/actions.ts`
- Create: `apps/web/components/user-menu.tsx`

**Interfaces:**
- Consumes: `DropdownMenu*` (Task 7), `auth`'s `signOut` (existing, `apps/web/auth.ts`).
- Produces: `Avatar`, `AvatarFallback`; `logOut()` server action; `UserMenu({ name })` — consumed by Task 12 (`ShellLayout`).

The original `ShellLayout` declared `logOut` as an inline `'use server'` function *inside* the (Server Component) layout — that pattern only works inside a Server Component. `UserMenu` has to be a Client Component (it's an interactive dropdown), so the action moves to its own `'use server'` file that both Server and Client Components can import.

- [ ] **Step 1: `components/ui/avatar.tsx`**

```tsx
'use client';

import { forwardRef } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/cn';

export const Avatar = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-2 font-body text-sm font-semibold text-accent-2-ink',
      className
    )}
    {...props}
  />
));
Avatar.displayName = 'Avatar';

export const AvatarImage = AvatarPrimitive.Image;

export const AvatarFallback = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback ref={ref} className={cn('flex h-full w-full items-center justify-center', className)} {...props} />
));
AvatarFallback.displayName = 'AvatarFallback';
```

- [ ] **Step 2: `lib/actions.ts`**

```ts
'use server';

import { signOut } from '@/auth';

export async function logOut() {
  await signOut({ redirectTo: '/web/login' });
}
```

- [ ] **Step 3: `components/user-menu.tsx`**

```tsx
'use client';

import { logOut } from '@/lib/actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function UserMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Account menu for ${name}`}>
        <Avatar>
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5 text-text-muted">{name}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-left">
              Log out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass. (`UserMenu` isn't rendered anywhere yet — Task 12 wires it into the shell.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/avatar.tsx apps/web/lib/actions.ts apps/web/components/user-menu.tsx
git commit -m "Add Avatar primitive, a standalone logOut server action, and UserMenu"
```

---

### Task 10: `ComingSoon` restyle

**Files:**
- Modify: `apps/web/components/coming-soon.tsx` (full rewrite)

**Interfaces:**
- Consumes: Tailwind utilities from Task 2 only.
- Produces: no interface change — `<ComingSoon label="..." />` prop stays identical, every existing call site (collection/profile, both spaces) needs no changes.

- [ ] **Step 1: Rewrite**

Replace `apps/web/components/coming-soon.tsx` entirely with:

```tsx
export function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="font-display text-lg text-text">{label}</p>
      <p className="text-sm text-text-muted">Coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass.

- [ ] **Step 3: Manual check**

Visit `/collection` (or any of the four stub pages). Expected: centered empty-state text in the display font, no longer plain gray body text.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/coming-soon.tsx
git commit -m "Restyle ComingSoon as a proper empty state using the token layer"
```

---

### Task 11: `BottomNav`

**Files:**
- Create: `apps/web/components/bottom-nav.tsx`

**Interfaces:**
- Consumes: `parseSpacePath`, `spaceHref`, `ViewTab` (existing, unchanged).
- Produces: `BottomNav` (no props) — consumed by Task 12 (`ShellLayout`).

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t-[length:var(--border-w)] border-border bg-surface-raised pt-2 md:hidden"
      style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
    >
      {TABS.map(({ tab, label }) => (
        <button
          key={tab}
          type="button"
          onClick={() => router.push(spaceHref(groupId, tab))}
          aria-current={tab === activeTab ? 'page' : undefined}
          className={
            tab === activeTab
              ? 'flex min-h-11 min-w-11 flex-col items-center justify-center px-3 font-body text-xs font-semibold text-accent'
              : 'flex min-h-11 min-w-11 flex-col items-center justify-center px-3 font-body text-xs text-text-muted'
          }
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
```

`md:hidden` keeps this mobile-only; Task 12's desktop tab strip is `hidden md:block`, so exactly one of the two is ever visible. `env(safe-area-inset-bottom)` keeps tap targets clear of the on-screen gesture bar on notched Android devices when the PWA is installed in standalone mode.

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass. (Not rendered anywhere yet — Task 12 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/bottom-nav.tsx
git commit -m "Add BottomNav for the mobile shell"
```

---

### Task 12: `ShellLayout` — split desktop top-nav / mobile bottom-nav

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx` (full rewrite)

**Interfaces:**
- Consumes: `GroupSwitcher` (Task 7), `ViewTabs` (Task 6), `UserMenu` (Task 9), `BottomNav` (Task 11).
- Produces: no interface change — this is the top-level layout for every route under `app/(shell)/`, nothing imports it directly.

This is where every earlier task's component actually becomes visible together for the first time.

- [ ] **Step 1: Rewrite**

Replace `apps/web/app/(shell)/layout.tsx` entirely with:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { GroupSwitcher } from '@/components/group-switcher';
import { ViewTabs } from '@/components/view-tabs';
import { UserMenu } from '@/components/user-menu';
import { BottomNav } from '@/components/bottom-nav';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Belt-and-braces: proxy.ts's middleware already redirects unauthenticated
  // requests before they reach here, but a layout shouldn't assume that and
  // render a broken header if it's ever reached without a session.
  if (!session?.user) redirect('/web/login');

  const name = session.user.name ?? 'Account';

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="flex items-center justify-between gap-3 bg-surface-raised px-4 py-3"
        style={{ borderBottom: 'var(--border-w) solid var(--border)' }}
      >
        <GroupSwitcher />
        <div className="hidden md:block">
          <ViewTabs />
        </div>
        <UserMenu name={name} />
      </header>
      <main className="flex-1 p-4 pb-20 md:pb-4">{children}</main>
      <BottomNav />
    </div>
  );
}
```

`main`'s `pb-20` (mobile) / `md:pb-4` (desktop) reserves space so page content isn't hidden behind the fixed `BottomNav` on small screens, without adding unnecessary bottom padding on desktop where `BottomNav` is `hidden`.

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass.

- [ ] **Step 3: Manual check — full walkthrough**

With the dev server running and logged in, at a desktop width (≥768px): header shows group switcher, the horizontal tab strip, and the avatar menu; no bottom nav visible. Resize below 768px: header shrinks to just the group switcher and avatar menu; the tab strip disappears; a bottom nav with three large tap targets appears and highlights the active section. Navigating via either the desktop tabs or the bottom nav updates the URL identically (same `/calendar`, `/groups/:id/collection`, etc. as before this plan started).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(shell)/layout.tsx"
git commit -m "Split ShellLayout into desktop top-nav / mobile bottom-nav"
```

---

### Task 13: `AppearanceSettings` on the personal profile page

**Files:**
- Create: `apps/web/components/appearance-settings.tsx`
- Modify: `apps/web/app/(shell)/profile/page.tsx`

**Interfaces:**
- Consumes: `useTheme` (from `next-themes`, Task 5), `useStyle`/`Style` (Task 4), `Button` (Task 3).
- Produces: no interface change — this only adds UI, nothing else depends on it.

Deliberately only the *personal* profile page (`apps/web/app/(shell)/profile/page.tsx`), not the group-scoped one (`apps/web/app/(shell)/groups/[groupId]/profile/page.tsx`) — appearance is a per-browser preference, not a group setting.

- [ ] **Step 1: `components/appearance-settings.tsx`**

```tsx
'use client';

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-display text-base">Theme</h3>
        <div className="mt-2 flex gap-2">
          {(['light', 'dark', 'system'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={theme === option ? 'primary' : 'secondary'}
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
```

- [ ] **Step 2: Wire it into the personal profile page**

Replace `apps/web/app/(shell)/profile/page.tsx` entirely with:

```tsx
import { ComingSoon } from '@/components/coming-soon';
import { AppearanceSettings } from '@/components/appearance-settings';

export default function PersonalProfilePage() {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="font-display text-xl">Appearance</h2>
        <div className="mt-4">
          <AppearanceSettings />
        </div>
      </section>
      <ComingSoon label="Profile" />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass.

- [ ] **Step 4: Manual check**

Visit `/profile`. Click each Theme button — light/dark/system all apply immediately; reload the page and confirm the choice persisted. Click each Style button — all five apply immediately (including Comic Sans); reload and confirm persistence. Then visit a group's profile page (`/groups/:id/profile`) and confirm it's unchanged — still just the "Coming soon" stub, no Appearance section.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/appearance-settings.tsx "apps/web/app/(shell)/profile/page.tsx"
git commit -m "Add Appearance settings (theme + style) to the personal profile page"
```

---

### Task 14: PWA manifest colors

**Files:**
- Modify: `apps/web/public/manifest.json`

**Interfaces:** none — a static asset, no code depends on its exact values beyond what the OS reads for install/splash.

- [ ] **Step 1: Update the manifest**

Replace `apps/web/public/manifest.json` entirely with:

```json
{
  "name": "Board Game Group",
  "short_name": "BGGG",
  "description": "Organise play sessions with your board game group",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FFF3E0",
  "theme_color": "#E1553A",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

Icon files are unchanged — redesigning them is out of scope for this plan.

- [ ] **Step 2: Verify**

Run: `npm run build --workspace=apps/web`
Expected: passes (this file isn't part of the TypeScript build, but the check confirms nothing else broke).

- [ ] **Step 3: Manual check**

With the dev server running, open devtools → Application tab → Manifest. Expected: `background_color` and `theme_color` swatches show the new cream/coral values, not the old indigo (`#4f46e5`)/gray (`#f9fafb`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/manifest.json
git commit -m "Update PWA manifest colors to match the Marigold & Coral default"
```

---

### Task 15: Final verification pass

**Files:** none — this task only runs checks across everything built in Tasks 1-14.

- [ ] **Step 1: Full build + lint**

Run: `npm run build --workspace=apps/web` and `npm run lint --workspace=apps/web`
Expected: both pass cleanly with zero errors or warnings introduced by this plan.

- [ ] **Step 2: Launch the dev server**

Use the `run` skill (or `npm run dev:web` from the repo root) to start `apps/web` against a real backend session.

- [ ] **Step 3: Walk every style × theme combination**

On `/profile`, cycle through all 5 styles at both light and dark (10 combinations total). For each: confirm the background/text/accent colors visibly change, the display/body/mono fonts change, and nothing renders unreadable (e.g. check Comic Sans's near-black-on-white and neon-green-on-black both stay legible, and Bevel/Mixed's shadow-heavy cards don't clip oddly).

- [ ] **Step 4: Walk both breakpoints**

At desktop width: confirm top nav (switcher, tabs, avatar menu) with no bottom nav. At mobile width (< 768px): confirm compact header + bottom nav with no visible desktop tab strip, and that tapping bottom-nav items and the group switcher both work with the on-screen keyboard/touch (or devtools' touch emulation).

- [ ] **Step 5: Regression-check the calendar flow**

Open a proposal from the calendar in both spaces (personal and a group). Confirm the side-sheet still shows the same data (date, status, proposer, host, RSVPs, suggested games with vote counts) as before this plan, just restyled — this is the one existing feature with real data flowing through retrofitted components, so it's the most likely place a rewrite mistake would surface.

- [ ] **Step 6: Record results**

If every check in Steps 3-5 passes, the feature is done. If anything fails, fix it as a follow-up commit on top of the relevant task — do not mark the feature complete with a known-broken check.
