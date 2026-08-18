# Frontend Design System + Shell Retrofit — Design

## Problem

`apps/web` has a working shell (group switching, tab navigation, a
read-only calendar) but no visual identity — plain unstyled Tailwind
defaults (gray/white, no type scale, no spacing/radius decisions) — and
three of its shell components (`ViewTabs`, `GroupSwitcher`,
`ProposalDetailPanel`) were built with the minimum markup needed to prove
the shell worked, not with real component primitives: `ViewTabs` is a
bare `<nav>` of links with no ARIA, `GroupSwitcher` is a native `<select>`
with no dropdown/popover, and `ProposalDetailPanel` is a `fixed` panel
with no backdrop, focus trap, or portal. Every future feature screen
(collection browsing, reviews, play-session logging, stats) will be built
on top of whatever visual language and component primitives exist today —
so establishing both now, before more screens accumulate on the unstyled
baseline, is worth doing as its own piece of work rather than a side
effect of the next feature.

## Goals

- A committed visual identity ("Marigold & Coral" — warm, rounded,
  indie/playful; see the design exploration referenced below) expressed as
  a token system (color, type, spacing/radius, one signature motif — a
  flat "sticker" offset shadow) rather than one-off Tailwind classes.
- Four additional selectable style variants on the same token mechanism
  (Tactile, Starburst & Bevel, Gumdrop & Gloss, and a joke Comic Sans
  option), plus independent light/dark support for all five — a real,
  cheap "appearance" preference, not a maintenance burden, because every
  variant is just a different set of CSS custom property values behind
  the same components.
- A small set of accessible component primitives
  (`components/ui/{button,card,input,badge,tabs,dropdown-menu,dialog,avatar}.tsx`)
  wrapping Radix UI, that this feature's retrofit and all future feature
  work build on.
- `ViewTabs`, `GroupSwitcher`, and `ProposalDetailPanel` rebuilt on those
  primitives, fixing real gaps (no ARIA tab semantics, no accessible
  dropdown, no focus trap/backdrop on the proposal panel) as part of the
  same pass, not just restyled.
- A responsive shell split: the current single top-bar `ShellLayout`
  becomes a top nav on desktop/tablet and a bottom tab bar on mobile,
  since the app's primary target is Android installed as a PWA
  (`design.md`'s stated primary target; `notes/3_pwa.md`).
- `manifest.json` and the root layout's `viewport.themeColor` updated to
  match the committed default (Marigold & Coral, light).

## Non-goals (this round)

- Any new feature screen. Collection browsing, reviews/comments, play
  session logging, and statistics remain out of scope — this is the
  design system and shell retrofit they'll eventually be built on, not
  those screens themselves.
- Changing `GroupSwitcher`'s data-fetching (client-side `useEffect` +
  local state, no cache/SWR) or `apiFetch`'s contract. This round only
  changes how the switcher is *presented* (Radix `DropdownMenu` instead of
  a native `<select>`), not how it fetches groups.
- A manual light/dark toggle that overrides the OS preference beyond what
  `next-themes` gives for free — `next-themes` already supports this via
  its `attribute`/`storageKey` mechanism, so no extra work is implied, but
  building a dedicated toggle UI beyond the Appearance section described
  below is not a goal of this round.
- Making the PWA manifest itself reactive to the runtime theme/style
  choice. `manifest.json` is a static file read by the OS before any JS
  runs (for the install icon and splash screen) — it is fixed to the
  default (Marigold & Coral, light) and cannot follow the user's later
  in-app choice. Only the live `<meta name="theme-color">` tag updates at
  runtime.
- Standing up frontend test infrastructure. `apps/web` has none today
  (confirmed in `docs/reference/frontend-architecture.md`); this feature
  is verified via `npm run build`, `npm run lint`, and manual/browser
  checks against the dev server, consistent with how the shell itself was
  verified.

## Approach

### Visual identity

Explored via an iterative style-tile artifact (five real directions plus
one explicit joke option), landing on **Marigold & Coral** as the
committed default:

- **Color** (light): `#FFF3E0` background, `#3B2A34` text, `#E1553A`
  primary accent, `#2E8B84` secondary accent, `#F4B942` highlight,
  `#8C5B45` muted/border tone. Dark mode is a separate hand-tuned palette
  (`#241A22` background, brightened accents), not an inversion.
- **Type**: Fredoka (display/headings only), Nunito (body), Space Mono
  (numeric data — ratings, counts, dates).
- **Signature**: a flat, colored offset shadow (`3px 3px 0
  var(--border-strong)`, no blur) on cards/buttons/badges instead of a
  soft drop shadow — the one recurring, deliberate motif.
- Four alternate variants (Tactile, Starburst & Bevel, Gumdrop & Gloss,
  and a joke Comic Sans option) exist on the same mechanism and remain
  user-selectable; they are not deleted, just not the default.

### Token architecture

`apps/web/app/globals.css` defines CSS custom properties scoped by two
independent attributes on `<html>`:

```
[data-style="playful|tactile|clipart|mixed|comic"]  — which of the 5 identities
[data-theme="light|dark"]                            — resolved by next-themes
```

Each `[data-style]` block sets both color variables (`--bg`, `--text`,
`--accent`, `--accent-2`, `--highlight`, `--muted-tone`, `--border`,
`--shadow`, ...) and structural variables (`--font-display`,
`--font-body`, `--font-mono`, `--radius-sm`, `--radius-md`, `--border-w`,
`--shadow-card`, `--rule-border`, `--tab-indicator`, `--badge-rotate`),
the same pattern validated in the style-tile exploration, renamed from
that prototype's placeholder names (`--meeple`, `--felt`, `--dice`,
`--walnut`) to semantic ones (`--accent`, `--accent-2`, `--highlight`,
`--muted-tone`) now that this is production code, not a side-by-side
comparison. A `@theme` block maps these into real Tailwind v4 utilities:

```css
@theme {
  --color-bg: var(--bg);
  --color-accent: var(--accent);
  /* ... */
}
```

so components use `bg-bg`, `text-text`, `bg-accent`, etc. rather than raw
`var(...)` — normal Tailwind usage, just backed by runtime-switchable
values instead of Tailwind's compile-time-only defaults.

### Switching mechanism — two independent axes, two right-sized tools

- **`theme` (light/dark/system)**: `next-themes`. Built exactly for this —
  system-preference resolution, a no-flash-of-wrong-theme blocking script,
  localStorage persistence — via its `attribute="data-theme"` option.
- **`style` (5 variants, default `playful`)**: a small hand-rolled
  `StyleProvider` (React context + localStorage + the same blocking-script
  no-flash technique `next-themes` uses internally), attribute
  `data-style`. `next-themes` models light/dark specifically; it doesn't
  fit "which of 5 product identities," so this axis gets its own minimal
  provider rather than being forced through `next-themes`'s API.

Both controls surface under a new **Appearance** section on the existing
`/profile` page — not in the main header, since this is a rarely-touched
preference that shouldn't compete for space with primary navigation.

### Component layer

New dependencies: `@radix-ui/react-{tabs,dropdown-menu,dialog,avatar,slot}`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `next-themes`.

New files: `lib/cn.ts` (the standard `clsx` + `tailwind-merge` helper),
`components/ui/{button,card,input,badge,tabs,dropdown-menu,dialog,avatar}.tsx`
— Radix primitives styled with the token system, variants via
`class-variance-authority`, following the shadcn convention of owning the
component code in-repo rather than importing a prebuilt library.

### Retrofitting the three existing shell components

- **`ViewTabs`**: currently a plain `<nav>` of `<Link>`s; active tab comes
  from `parseSpacePath(usePathname())`, no local state, no ARIA. Rebuilt
  on Radix `Tabs` as a *controlled* component — `value` bound to
  `parseSpacePath`'s result, `onValueChange` calls
  `router.push(spaceHref(...))` — so the URLs and navigation behavior are
  unchanged, only the markup gains real tab semantics and the
  sticker-shadow active indicator.
- **`GroupSwitcher`**: currently a native `<select>` with an inline
  "create group" form below it. Replaced with Radix `DropdownMenu` for
  real accessible menu behavior; the group list still comes from the same
  client-side `useEffect` fetch into local state (see Non-goals), and the
  inline create-group form is restyled, not restructured.
- **`ProposalDetailPanel`**: currently a `fixed` right-side panel with no
  backdrop, focus trap, or portal — an accessibility gap, not just a style
  one. Moved onto Radix `Dialog` styled as a side-sheet
  (`Dialog.Content` positioned `right-0 h-full w-80`), which gets focus
  trap, Escape-to-close, and a backdrop for free since the primitive is
  needed anyway. The existing `proposalId`/`onClose`-prop contract from
  the parent is unchanged.
- **`ComingSoon`**: restyled only, as a proper empty state using the new
  type/tokens.

### Shell layout — mobile bottom nav vs. desktop top nav

`app/(shell)/layout.tsx`'s single `<header>` splits by breakpoint, both
sides going through the unchanged `parseSpacePath`/`spaceHref` helpers:

- **Desktop/tablet (`md:` and up)**: current top-bar structure, restyled
  — `GroupSwitcher` (now a dropdown) + `ViewTabs` (now Radix tabs) + a
  user menu on the right.
- **Mobile (below `md:`)**: a slim top bar with just the group switcher
  and an avatar/user menu, plus a new fixed `BottomNav` rendering the same
  three tabs as large (44px+ per Android touch-target guidance) tap
  targets, with `padding-bottom: env(safe-area-inset-bottom)` for notched
  devices in installed/standalone PWA mode. `BottomNav` is plain semantic
  links, not Radix `Tabs` — a bottom icon bar doesn't need
  tablist/arrow-key semantics the way the desktop horizontal strip does.

### PWA specifics

- `public/manifest.json`: `background_color` → `#FFF3E0`,
  `theme_color` → `#E1553A` (Marigold & Coral, light — see Non-goals for
  why this can't be dynamic).
- `app/layout.tsx`'s `viewport.themeColor` gets the same default. The
  `ThemeProvider`/`StyleProvider` additionally update the live
  `<meta name="theme-color">` DOM node at runtime, so the Android status
  bar color tracks the actual active theme/style after the app has
  loaded, even though the manifest-level splash screen stays fixed.

### Verification

No browser automation is available in this environment (Claude in Chrome
is not connected this session). Verification is: `npm run build` and
`npm run lint` in `apps/web` for correctness, plus the `run` skill to
launch the dev server and take screenshots at both breakpoints × both
themes × the default style for a manual self-review pass before calling
any task done — consistent with how the rest of the frontend has been
verified (`docs/reference/frontend-architecture.md`'s "no test
infrastructure" note).

## Risks

- **Tailwind v4 `@theme` + runtime CSS custom properties**: `@theme` is
  normally used for compile-time-fixed design tokens; mapping its
  variables through `var(--runtime-thing)` indirection to support
  runtime switching is the right pattern here but is worth validating
  early (first implementation task) rather than discovering a build-time
  edge case midway through the retrofit.
- **No-flash-of-wrong-style**: the hand-rolled `StyleProvider` needs its
  own blocking inline script (mirroring `next-themes`'s technique) to set
  `data-style` before first paint; getting this wrong reproduces the
  classic "flash of default theme" bug, just on the style axis instead of
  light/dark.
- **`ProposalDetailPanel` → `Dialog` migration**: moving from an
  unstyled `fixed` panel to a real `Dialog` changes focus behavior (focus
  moves into the panel on open, returns to the trigger on close) — worth
  explicitly checking this doesn't fight with the calendar grid's own
  click handling when a panel is opened from a day cell.
- **Scope creep into feature work**: because this touches the shell that
  every screen renders inside, it will be tempting to also improve the
  collection/profile stubs while in the area. Non-goals above are
  deliberately explicit that this round stops at the shell.
