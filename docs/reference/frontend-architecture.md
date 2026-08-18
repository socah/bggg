# Frontend Architecture

Living reference for `apps/web`'s app shell — routing, the two-space model,
the design token system, and how the frontend talks to `apps/api`. Describes
current behavior — for the history of *why* it looks like this, see
`docs/superpowers/specs/2026-08-17-main-ui-shell-design.md` +
`docs/superpowers/plans/2026-08-17-main-ui-shell-calendar.md` (the shell
itself) and `docs/superpowers/specs/2026-08-18-frontend-design-system-design.md`
+ `docs/superpowers/plans/2026-08-18-frontend-design-system.md` (the design
system and shell retrofit described below).

## Design tokens and switchable appearance

`apps/web/app/globals.css` defines two independent, runtime-switchable
attributes on `<html>`:

- `data-style` — which of 5 visual identities is active: `playful`
  (default — no attribute at all), `tactile`, `clipart`, `mixed`, `comic`.
  Each sets ~14 color custom properties (`--bg`, `--text`, `--accent`,
  `--accent-2`, `--highlight`, `--muted-tone`, ...) and ~10 structural ones
  (`--font-display-face`, `--radius-token-sm`, `--shadow-card`,
  `--rule-border`, `--tab-indicator`, `--badge-rotate`, `--border-w`, ...).
- `data-theme` — `light` | `dark`, resolved by `next-themes`
  (`components/theme-provider.tsx`).

A `@theme inline` block maps the color/font/radius custom properties into
real Tailwind utilities (`bg-bg`, `text-text-muted`, `bg-accent`,
`font-display`, `rounded-md`, ...) — components use these normally: `@theme
inline` keeps them referencing the runtime variable instead of a
build-time-frozen value, which is what makes switching style/theme actually
repaint the page. The handful of composite "signature" values
(`--shadow-card`, `--rule-border`, `--tab-indicator`, `--badge-rotate`,
`--border-w`) don't correspond to a Tailwind namespace and are applied via
inline `style` (destructured and merged, not overwritten — see
`components/ui/button.tsx`, `card.tsx`, `badge.tsx` for the pattern) or a
Tailwind arbitrary-property utility (`border-[length:var(--border-w)]`,
`data-[state=active]:[border-bottom:var(--tab-indicator)]`).

Two independent providers own the two axes, both mounted in
`app/providers.tsx` (`SessionProvider > ThemeProvider > StyleProvider >
ThemeColorSync + children`):
- `components/theme-provider.tsx` — thin wrapper around `next-themes`.
- `components/style-provider.tsx` — hand-rolled (`useStyle()`,
  `<StyleScript />` for a no-flash blocking script mirroring `next-themes`'s
  own technique, localStorage-persisted under `bggg-style`).
- `components/theme-color-sync.tsx` — keeps the live `<meta
  name="theme-color">` tag in sync with whichever theme/style is active
  (the PWA manifest's `theme_color` is static and can't follow this; it's
  fixed to the default style's light-mode accent).

Both are user-facing on the personal profile page's **Appearance** section
(`components/appearance-settings.tsx`, wired into `app/(shell)/profile/page.tsx`
only — not the group-scoped profile page, since appearance is a per-browser
preference, not a group setting).

`components/ui/{button,card,input,badge,tabs,dropdown-menu,dialog,avatar}.tsx`
are small Radix-UI-wrapped primitives, styled via the token layer, owned
in-repo (the shadcn convention) rather than imported as a library. `Tabs`
(`ui/tabs.tsx`) is currently unused by any shell component — see the
`ViewTabs` note below — but is a legitimate primitive for a future same-page
tab UI.

## Two spaces, one set of views

The shell has two parallel "spaces" that the same three views (calendar,
collection, profile) render into:

- **User-level space** (no group selected) — aggregates across every group
  the user belongs to. This is `/`'s default landing state.
- **Group-level space** (a group selected) — scoped to one group's members.

Routing:

```
/calendar, /collection, /profile                       — user-level
/groups/[groupId]/calendar, .../collection, .../profile — group-level
```

Both route families live under one route group, `app/(shell)/layout.tsx`,
which is otherwise invisible in the URL. `app/page.tsx` redirects `/` to
`/calendar`. The layout renders responsively, not as one fixed header:

- **Desktop/tablet (`md:` and up):** a header with `<GroupSwitcher />`
  (a Radix `DropdownMenu`), `<ViewTabs />` (real `<Link>`s + `aria-current`,
  not Radix `Tabs` — each "tab" navigates to a different route rather than
  swapping an in-page panel, so the tabs/tabpanel ARIA pattern doesn't apply
  here), and `<UserMenu />` (name, a disabled Settings stub, Log out).
- **Mobile (below `md:`):** a slim header with just `<GroupSwitcher />` and
  `<UserMenu />`, plus a fixed `<BottomNav />` with the same three
  destinations as large (44px+) tap targets, `hidden`/shown exactly opposite
  `<ViewTabs />`'s wrapper so precisely one nav surface is ever visible.

`<UserMenu />` (`components/user-menu.tsx`) owns logout via a standalone
`'use server'` action, `lib/actions.ts`'s `logOut()` — it has to live in its
own file rather than declared inline, because `UserMenu` is a Client
Component and inline `'use server'` functions only work inside a Server
Component.

`apps/web/lib/space.ts`'s `parseSpacePath(pathname)` / `spaceHref(groupId,
tab)` are the single source of truth for parsing a URL into `{ groupId,
tab }` and building one back — both `<GroupSwitcher />` and `<ViewTabs />`
go through these, which is what makes switching tabs preserve the current
space and switching space preserve the current tab. Anything that needs to
navigate within the shell should use these helpers rather than
constructing `/groups/...` paths by hand.

Every user always has at least one group to select: `GroupsService.findAll`
(`apps/api`) auto-provisions a solo group ("Just Me", flagged `is_solo:
true`) the first time a user with zero memberships is looked up — see
`db/schema.sql`'s `groups` table comments for the provisioning/race-safety
details. The frontend never has to special-case "no groups yet."

## Talking to `apps/api`

`apps/api`'s `AuthGuard` requires `Authorization: Bearer <JWT>` on every
request — there is no cookie-based auth path (see
`docs/reference/authentication-keycloak.md`'s "Frontend calls to apps/api
need the raw access token" section for the full rationale and the
Auth.js token-refresh mechanics).

**Every** frontend API call goes through `apps/web/lib/api.ts`'s
`apiFetch(path, init)` — never a raw `fetch('/api/...')`. It:

- Reads the session via `next-auth/react`'s `getSession()` (requires
  `<SessionProvider basePath="/web/auth">`, mounted once in
  `app/providers.tsx` and wrapped around `{children}` in the root
  `app/layout.tsx` — the `basePath` must match `auth.ts`'s, or
  `next-auth/react`'s client helpers silently target the wrong route,
  since `/api/*` is unconditionally routed to the NestJS backend).
- Forces a sign-out (redirecting to `/web/login`) if the session is
  already known-dead (`session.error === 'RefreshTokenError'`) or if the
  request itself comes back `401`.
- Attaches `Authorization: Bearer <session.accessToken>` via `Headers`
  normalization (`new Headers(init.headers)` + `.set(...)`), so any valid
  `HeadersInit` shape a caller passes (plain object, `Headers` instance,
  tuple array) is preserved.

`apiFetch` does **not** throw on a non-2xx, non-401 response — it returns
the `Response` as-is. Every call site is responsible for its own
`response.ok` check before trusting the body; this has been the source of
several real bugs during this feature's development (a non-2xx JSON error
body treated as success data, corrupting state or crashing on render) —
when adding a new `apiFetch` call, check `response.ok` explicitly rather
than assuming success.

## Data hooks and components

- `hooks/use-proposals.ts` — `useGroupProposals(groupId)` and
  `useAggregateProposals()` (fans out `GET /groups` → per-group `GET
  /groups/:id/proposals`, tagging each result with `groupName`). Both
  filter out `status: 'cancelled'` proposals and return `{ proposals,
  loading, error, retry }`.
- `hooks/use-proposal-detail.ts` — `useProposalDetail(proposalId)`,
  fetching `GET /proposals/:id` (`{ proposal, rsvps, games }`).
  Deliberately separate from `<ProposalDetailPanel>`'s rendering, so a
  future interactive control (RSVP/vote/host — not built yet) can consume
  the same fetched shape and trigger a refetch without the panel needing a
  rewrite.
- `hooks/use-group-members.ts` — `useGroupMembers(groupId)`, resolving
  `GET /groups/:groupId/members` (`{ id, displayName }[]`) so proposer/
  host/RSVP names can be shown instead of raw Keycloak subs.
- `lib/calendar-grid.ts` — pure date-grid functions: `buildMonthGrid`,
  `toDateKey`, and `placementDateKey` (the calendar's placement rule —
  `confirmedStart`'s date if set, else `proposedDate` as-is; see the
  in-file comment for why `proposedDate`, a bare `"YYYY-MM-DD"` string,
  must never be round-tripped through `new Date()`).
- `components/calendar-month-grid.tsx`, `components/proposal-detail-panel.tsx`
  — pure presentation over the hooks above. The calendar is **read-only**:
  no RSVP/vote/host/confirm/create-proposal UI exists yet anywhere in the
  frontend.
- `components/group-switcher.tsx`, `components/view-tabs.tsx`,
  `components/bottom-nav.tsx`, `components/user-menu.tsx` — the shell's
  navigation, all built on `lib/space.ts`.
- `components/coming-soon.tsx` — the stub used by the three Collection/
  Profile pages that still have no real data (Collection in both spaces,
  Profile in group space). The personal Profile page is no longer a pure
  stub — see below.

## What's not built yet

- Collection views (both spaces) and the group-scoped profile view are
  static placeholders — no backend endpoints exist for "combined
  collection" or "group stats" yet. The **personal** profile page
  (`app/(shell)/profile/page.tsx`) now hosts a real Appearance section
  (`components/appearance-settings.tsx`) on top of the `ComingSoon` stub —
  see "Design tokens and switchable appearance" above.
- No settings functionality (the header's Settings button is permanently
  disabled).
- No group creation UI beyond the switcher's minimal inline "+ New group"
  form; no invite-acceptance UI (the backend invite flow exists but has no
  frontend).
- No frontend test infrastructure (`apps/web/package.json` has no test
  runner) — this codebase is verified via `npm run build` (typecheck) and
  `npm run lint`, plus manual/browser verification for anything those two
  can't catch.
