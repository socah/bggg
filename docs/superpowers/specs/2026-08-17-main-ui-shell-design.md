# Main UI Shell + Calendar View — Design

## Problem

`apps/web` currently has no real UI — just Auth.js login scaffolding and a
static placeholder home page. The backend, by contrast, already has a
substantial amount of functionality built (groups with membership,
play-session-proposal scheduling with RSVPs/hosting/game-voting, a games
cache, an iCal feed) with no frontend surface at all. We need the first
real screen of the app: a persistent shell (identity, navigation, group
switching) plus one fully-functional view (the monthly calendar) that
proves the shell works end-to-end against the live backend, while the
other two views it navigates to (collection, profile) are stubs.

## Goals

- A persistent app shell: current user's name, settings button, logout
  button, and navigation between three views (calendar, collection,
  profile).
- A group switcher that toggles between **user-level** (aggregate across
  every group the user belongs to) and **group-level** (scoped to one
  selected group) versions of all three views.
- A working monthly calendar view, in both spaces, showing an overview of
  scheduling actions (play session proposals and the sessions they
  resolve into), with a read-only detail panel.
- The minimum backend additions needed to support the above: solo-group
  auto-provisioning, a group-members-with-display-names endpoint, and
  folding proposal games into the existing proposal-detail endpoint.
- Collection and profile views exist as navigable stubs in both spaces
  (no real data), reserved for their own future specs.

## Non-goals (this round)

- Any RSVP, voting, hosting, confirming, or proposal-creation UI. The
  calendar is a **read-only overview**. The backend already fully
  supports these actions; wiring them into the UI is future work.
  **The calendar's data-fetching and rendering are deliberately split
  (a `useProposalDetail` hook separate from the panel's JSX) so that
  future interactive controls are additive, not a rewrite** — this is a
  forward-looking constraint on the implementation, not a feature being
  built now.
- Real data in the collection or profile views, in either space. Both
  are static "coming soon" placeholders.
- Group creation via invites, or any invite-acceptance UI (the backend
  invite flow exists but has no frontend; out of scope here).
- Editing/renaming/deleting groups, or any group-management UI beyond
  the minimal inline "create a new group" form in the switcher.
- Week/day calendar views, drag-to-reschedule, recurring events,
  pagination/virtualization for days with many items (a simple "+N more"
  cutoff is enough), or spontaneous (non-proposal-linked) session
  logging (no API exists for that yet regardless).
- Standing up frontend test infrastructure (Vitest/RTL). `apps/web` has
  none today; this feature is verified manually through the dev server.

## Approach

### Two spaces, one set of views

The app has two parallel "spaces" that the same three views (calendar,
collection, profile) render into:

- **User-level space** (no group selected) — aggregates across every
  group the user belongs to. This is the default landing state.
- **Group-level space** (a group selected) — scoped to one group's
  members.

Every user always belongs to at least one group: a backend-provisioned
**solo group** (a real `groups` row containing only that user, flagged
`is_solo: true`). This exists so a user can eventually log solo
proposals/sessions without needing a real multi-member group (the FK on
`play_session_proposals.group_id` is `NOT NULL`), and so the group
switcher is never empty. It is a different mechanism from, and
complementary to, the user-level space: the user-level space is the
*union* of all your groups' activity; selecting your solo group
specifically shows *only* your solo-logged activity.

### Routing

- `/calendar`, `/collection`, `/profile` — user-level views.
- `/groups/[groupId]/calendar`, `/groups/[groupId]/collection`,
  `/groups/[groupId]/profile` — group-level views.
- Both families share one layout (a route group) that renders the header
  — username, group switcher, settings button, logout button, view tabs
  — so switching tabs preserves the current space, and switching
  space/group preserves the current tab.
- `/` redirects (server-side) to `/calendar`.

### Group switcher

A client component listing `GET /api/groups` (always ≥1 row — the solo
group, plus any real groups), with a "Personal (all groups)" option at
the top that always navigates to the user-level route, and a minimal
inline "+ New group" form (name input → `POST /api/groups`) at the
bottom. No invite/member-management UI.

```
┌───────────────────────┐
│ Personal (all groups) │  → /calendar (or current tab, no groupId)
│ ───────────────────── │
│ ● Just Me (solo)      │  → /groups/<solo-id>/calendar (or current tab)
│   The Dice Tower      │  → /groups/<id>/calendar (or current tab)
│ ───────────────────── │
│ + New group [______]  │
└───────────────────────┘
```

### Frontend API access

The NestJS `AuthGuard` requires `Authorization: Bearer <JWT>` on every
request (HTTP and WebSocket) — there is no cookie-based auth path.
`next.config.ts` already rewrites `/api/*` same-origin to the backend,
which only pays off if the browser holds the raw Keycloak access token.

- Add `jwt`/`session` callbacks to `auth.ts`: on sign-in, persist
  `access_token`, `refresh_token`, and `expires_at` from the Keycloak
  `account` object; on each session read, refresh via Keycloak's
  refresh-token grant if the access token has expired. Without this,
  the app would start silently failing partway through a session, since
  Keycloak access tokens are short-lived by default.
- All API calls go through one shared client helper
  (`apps/web/lib/api.ts`, e.g. `apiFetch(path, options)`), which reads
  the token from `useSession()` and attaches the `Authorization` header.
  Centralizing here (rather than scattering raw `fetch('/api/...')`
  calls through components) is what keeps this decision cheaply
  reversible: switching later to a server-side BFF proxy (never
  exposing the token to browser JS) would mean changing this one file,
  not every call site. The token-exposed approach is accepted for now
  because this is a small, trusted-group app, not a public multi-tenant
  one.

### Backend additions

Three small, scoped changes to the existing NestJS backend:

1. **Lazy solo-group provisioning** — `GroupsService.findAll`: if the
   requesting user has zero `group_members` rows, create a `groups` row
   (`is_solo: true`, name fixed as `"Just Me"` — no per-user
   personalization, since nothing in the backend today resolves a
   user's *own* display name from their JWT, and the UI already labels
   it distinctly via `is_solo`) and a membership row for them, before
   returning the list. Self-healing for existing users; no change
   needed to the registration or invite-acceptance code paths.
2. **`groups.is_solo` column** (migration + `Group` entity field,
   default `false`) — lets the UI label the solo group distinctly
   ("Just Me") and, later, hide invite/delete affordances on it.
3. **`GET /groups/:groupId/members`** — returns `{ userId, displayName
   }[]`, resolved via the existing `KeycloakAdminClient` (which already
   talks to the Keycloak Admin API for user creation/deletion). Used to
   label proposers, hosts, and RSVPs by name instead of raw Keycloak
   subs — nothing in the backend currently resolves a sub to a display
   name for anyone other than the logged-in user themself.
4. **Fold proposal games into `getProposal`** —
   `SchedulingService.getProposal` currently returns `{ proposal, rsvps
   }`; extend it to also include `games` (same
   proposal-games-plus-vote-count logic already in
   `listProposalGames`), returning `{ proposal, rsvps, games }`. This
   lets the calendar's detail panel resolve with a single request. The
   standalone `GET /proposals/:id/games` endpoint is unchanged (still
   useful for refreshing just the games list after a vote).

All four get unit tests following the existing Jest patterns in
`apps/api` (e.g. `groups.service.spec.ts`).

### Calendar view

**Data sourcing:** every `play_sessions` row today is created via
proposal finalization — there is no standalone "log a spontaneous
session" endpoint. So a `status: 'confirmed'` proposal *is* the
confirmed session for calendar purposes, and a group's proposal list is
a sufficient single data source. (If a standalone session-logging
endpoint is added later, the calendar will need a second data source
merged in — a known future seam, not handled now.)

**Two-tier fetching:**
- **Grid:** `GET /api/groups/:groupId/proposals` (group-level) or a
  client-side fan-out across the user's groups, merged (user-level) —
  lightweight rows only, enough to place badges.
- **Detail panel (on click):** `GET /api/proposals/:id`, now returning
  `{ proposal, rsvps, games }` in one call (see backend addition #4).

**Placement rule:** a proposal is placed on `confirmedStart`'s date if
set (status `confirming`/`confirmed`), else `proposedDate` (status
`collecting`) — reflects the resolved date once one exists.

**What's shown:** all non-cancelled proposals (`collecting`,
`confirming`, `confirmed`); cancelled proposals are hidden from the
grid.

**Grid layout:**
- Standard 7-column month grid; leading/trailing days from adjacent
  months shown grayed-out and unclickable.
- Header: month/year label, prev/next month controls, a "Today" button.
- Each in-month day cell shows up to a fixed number of badges (small
  dot + short label, e.g. "● 2 proposals", "✓ Wingspan night"), with a
  "+N more" cutoff rather than growing the cell.
- In user-level (aggregate) mode, each badge is also tagged with its
  source group's name (e.g. "Wingspan night — The Dice Tower").

**Detail panel (read-only):** clicking a day or a badge opens a side
panel/modal showing the proposal's date, status, host, RSVP list (now
resolvable to names via backend addition #3), and suggested games with
vote counts. No action buttons.

### Collection and profile stubs

Both views exist as routes and nav-tab destinations in both spaces
(`/collection`, `/groups/[groupId]/collection`, `/profile`,
`/groups/[groupId]/profile`), rendering a static "coming soon" message.
No data fetching, no backend changes. Reserved for their own future
specs — collection as "the union of a space's members' `game_ownership`
rows" (which, for the user-level space or a solo group, naturally
reduces to just the user's own collection with no special-casing), and
profile as aggregate stats over that same scope.

### Settings button

Also a stub for this round — either disabled with a tooltip or linking
to a placeholder route. No settings functionality is being designed
here.

## Error handling

- A 401 that survives the jwt-refresh attempt means the session is
  genuinely dead → sign out, redirect to login.
- Calendar/detail fetch failures show an inline retry state, not a page
  crash.
- A proposal that 404s on click (deleted between list-fetch and click)
  closes the panel with a "no longer available" message.
- Empty proposal lists render a blank grid — no special empty-state
  screen needed, since the solo group plus the user-level space mean
  the app is never in a truly empty state.
- Group-switcher fetch failures keep the last-known group list visible
  with a small inline error, rather than blocking navigation.

## Testing

- Backend additions (solo-group provisioning, `is_solo` column,
  members endpoint, merged proposal-games) get unit tests in
  `apps/api`'s existing Jest style.
- Frontend: no new test infrastructure this round. Verified manually
  via the dev server — golden path (switch spaces, switch groups,
  navigate tabs, open a calendar day, open a detail panel) plus a couple
  of edge cases (zero real groups i.e. solo-only, a day with more
  badges than fit, a 401 mid-session).

## Risks

- **Token-in-browser-JS approach** is a deliberate trade-off for a
  small trusted-group app; would need revisiting (BFF proxy) before any
  future multi-tenant or public-facing use.
- **Client-side fan-out** for the user-level calendar (one request per
  group) is fine at this app's expected scale (a handful of groups per
  user) but would need a real aggregate backend endpoint if that ever
  stopped being true.
- **`apps/web` has zero test infrastructure** — this feature doesn't
  add any, so regressions in the shell/calendar rely on manual
  verification until frontend testing is set up as its own effort.
