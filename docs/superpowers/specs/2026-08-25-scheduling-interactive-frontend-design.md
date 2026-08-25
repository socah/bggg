# Scheduling — Interactive Frontend & Backend Gaps

**Date:** 2026-08-25
**Status:** Approved for planning

---

## Problem

The scheduling backend is feature-complete (`notes/3_scheduling.md`, Decisions
A–G): proposals, RSVPs with availability windows, the
`collecting → confirming → confirmed`/`cancelled` state machine, host
designation, game voting, and the per-user iCal feed. The web app can only
*display* this data — of ~16 endpoints it consumes exactly 3 GETs. Every
member-facing interaction (create proposal, RSVP, lock in, finalize, cancel,
vote on games, subscribe to the calendar feed) requires raw HTTP calls.

Three gaps compound this:

1. **Orphaned `cancelled` status** — `apps/web` filters cancelled proposals
   out of the aggregate calendar and types the status, but no API endpoint
   can ever set it.
2. **No group library endpoint** — there is no way to list "games owned by
   members of this group", which any game-proposal picker needs.
3. **CORS omits `PUT`** — `apps/api/src/main.ts:42` allows GET/POST/PATCH/
   DELETE; the RSVP and host-designate endpoints use PUT and would fail for
   cross-origin browser clients.

## Goals

- A member can create a proposal (pick a date) from a group's calendar page.
- A member can RSVP yes/maybe/no to a proposal, optionally specifying an
  availability window (server default 10:00–02:00 otherwise, per Decision G).
- During `confirming`, yes/maybe holders can lock in / withdraw against the
  stored confirmed window.
- The creator (or group owner/admin) can request confirmation, finalize,
  undo, designate/clear a host, and cancel the proposal.
- Members can propose games (from the group library) for a proposal and
  upvote/unvote them.
- Each user can generate, copy, and regenerate their personal iCal feed URL.
- The month grid starts weeks on Monday and shows day initials
  (M T W T F S S).

## Non-goals

- No TanStack Query / optimistic updates — plain fetch + refetch now;
  documented as the migration path if needed.
- No proposal-scoped chat (Decision F stays deferred).
- No multi-day proposals (Decision G scope cut stands).
- No new calendar package (FullCalendar/react-day-picker evaluated and
  rejected — bundle weight vs. two small enhancements to our own grid).
- No rate limiting on `/calendar/me.ics` (stays deferred to `4_traefik`,
  per notes/3_scheduling.md "To revisit").

## Approach

### Backend additions (small)

1. **Cancel** — `POST /proposals/:id/cancel` in `ProposalsController` →
   `SchedulingService.cancel(proposalId, userId)`:
   - Allowed from any active status (`collecting`, `confirming`,
     `confirmed`) — finalized game nights still get called off.
   - Caller must be the proposal creator or hold owner/admin role in the
     proposal's group (same rule style as existing lifecycle actions).
   - If status was `confirmed`: delete the linked `play_sessions` row
     *before* flipping status (delete-before-flip, the same retry-safety
     ordering `undo()` uses), then set `cancelled`.
   - Terminal state; no un-cancel (create a new proposal instead).

2. **Group library** — `GET /groups/:groupId/games` in
   `GroupsController`/`GroupsService`:
   - Membership-guarded, any role (read access like other group reads).
   - Returns the deduplicated union of all members' `game_ownership` rows
     joined with their `games` records (id, bggId, name, thumbnail, player
     counts). This is the data source for the propose-game picker.

3. **CORS fix** — add `'PUT'` to the allowed methods in
   `apps/api/src/main.ts`.

Testing: Jest unit tests following existing service-spec patterns — cancel()
state transitions and permission checks; library union shape.

### Frontend architecture

Mutation helper in `lib/api.ts`:

```ts
export async function apiMutate(path: string, method: string, body?: unknown)
```

Wraps `apiFetch` with JSON serialization and typed error normalization
(message + status) so components render inline errors. Call sites carry a
comment noting this is deliberately Approach A (plain fetch + refetch) and
that TanStack Query is the migration path if caching/optimistic updates are
ever warranted.

New hooks (existing fetch-in-effect + `refreshKey` pattern):

| Hook | Wraps |
|---|---|
| `useProposalActions(proposalId)` | `rsvp`, `lockIn`, `requestConfirmation`, `finalize`, `undo`, `cancel`, `setHost`, `clearHost`; shared `{ pending, error }`; each triggers detail refetch |
| `useProposalGames(proposalId)` | List games w/ vote counts + `proposeGame`, `vote`, `unvote` |
| `useGroupLibrary(groupId)` | `GET /groups/:groupId/games` |
| `useCalendarFeedToken()` | `POST /calendar/token`; holds URL for copy/regenerate |

Existing read hooks (`hooks/use-proposals.ts`, `hooks/use-proposal-detail.ts`)
are unchanged — their comments already anticipate exactly this extension.

After any mutation the relevant `refreshKey`s are bumped so month-grid badges
and the open panel both update.

### UI flows

**Month grid** (`components/calendar-month-grid.tsx`,
`lib/calendar-grid.ts`): weeks start Monday (`buildMonthGrid` offset);
header row `M T W T F S S`. Badges/overflow/today behavior unchanged.

**Create proposal**: "New proposal" button on both calendar pages opens a
Dialog with a native `<input type="date">` (Android-friendly PWA target).
On success the new proposal auto-opens its detail panel (the backend already
creates the creator's self-RSVP).

**Detail panel** (`components/proposal-detail-panel.tsx`) becomes the action
hub; controls gated by role/status:

| Who | Sees |
|---|---|
| Any member | RSVP row Yes/Maybe/No (current answer highlighted). Choosing Yes/Maybe posts immediately — empty window = server default. Optional "specify hours" disclosure adds two `<input type="time">` fields saved with the RSVP. During `confirming`: lock-in toggle showing the stored window |
| Creator or group owner/admin | Contextual lifecycle strip: `collecting` → Request confirmation, Cancel; `confirming` → Finalize, Undo, Cancel; `confirmed` → Undo, Cancel. Host controls: "Make host" next to each yes-RSVP, host badge, clear host |
| Panel open | Games section: vote count + upvote toggle (highlighted if mine); "Add game" opens a picker fed by the group library, filtered client-side by name (the endpoint takes no query params) |

Destructive actions (Cancel proposal, Regenerate feed URL) confirm via a
Dialog first. Errors render inline beneath the triggering control.
A `cancelled` proposal renders as a muted banner state in the panel.

**iCal feed**: new "Calendar feed" card on the profile page — initially
"Generate feed URL"; once generated shows the copyable URL with Copy button
and a confirm-guarded Regenerate button that invalidates the old token.

### Verification

API-side logic gets Jest unit tests. The web app has lint/build only (no
test runner configured), so frontend verification is `npm run lint`,
`npm run build`, plus a manual walkthrough of each flow above against a
running dev stack.

## Data flow example

RSVP with hours specified: detail panel →
`useProposalActions.rsvp({ status: 'yes', availableStart: '18:00',
availableEnd: '23:00' })` → `PUT /proposals/:id/rsvp` → server resolves the
proposal's date + times into absolute timestamps (Decision G defaulting only
for absent values) → response ok → bump refreshKeys → panel refetches and
shows the highlighted answer; month-grid badge unaffected (status unchanged)
but list views stay consistent.
