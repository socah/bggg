# Play Session Scheduling — Proposals, RSVPs, iCal Feed Generation

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** `3_scheduling`
**Date:** 2026-07-11
**SecOps:** No

---

## What Is This?

Right now the platform can only log a play session *after it happened*
(`play_sessions` in `db/schema.sql`, already built). This topic builds what
comes before that: someone **proposes** a date, other group members
**RSVP** (yes/no/maybe), and once enough people are in, the proposal is
**confirmed** into an actual session. On top of that, we generate an **iCal
feed** — a URL that Google Calendar or Apple Calendar can subscribe to, so
members see confirmed sessions in whatever calendar app they already use,
without opening this app at all.

---

## Why Does It Matter for This Project?

`play_sessions.proposal_id` and `play_photos.session_id` have both been sitting
in `db/schema.sql` as forward references to tables that don't exist yet
("added later" comments). This topic is what finally lands them — and it's
the last piece standing between "log what happened" and "actually plan what's
next," which is the whole point of a group scheduling feature.

---

## The Decision

This topic bundles several decisions — data model, confirmation flow,
window-trimming, feed authentication, and vote integrity — because they
compound on each other.

### Decision A — Proposal/RSVP data model

Chose: two new tables. `play_session_proposals` (one row per proposal:
group, created by, a `proposed_date` picked up front — e.g. via a calendar
UI — and status) and `play_session_proposal_rsvps` (proposal_id, user_id,
response, unique on the pair).

Because: RSVPs are many-per-proposal and members change their mind, so a
dedicated join table with a `UNIQUE (proposal_id, user_id)` constraint
mirrors the `group_members` pattern already in this codebase — the database
itself prevents duplicate votes.

Alternative: a JSONB column on the proposal, e.g. `{"userId": "yes"}`.

Drawback of alternative: no constraint stops malformed or duplicate entries,
"how many yes votes" becomes a JS reduce instead of a `COUNT`, and there's no
per-row `updated_at` to know when someone last changed their answer.

### Decision B — Confirming a proposal (revised after user design)

Chose: a three-status state machine (`collecting → confirming → confirmed`,
or `cancelled`), where each RSVP additionally carries its own availability
window (`available_start`/`available_end`) and a per-row `confirmed` boolean
— not a single fixed proposal time with a one-shot confirm action.

The flow:
1. **`collecting`** (default): members RSVP `yes`/`maybe`/`no`, each with
   their own window (null window for `no`). The creator's own `yes` RSVP is
   created automatically alongside the proposal. Optionally, one `yes` RSVP
   holder is designated **host** (e.g. hosting at their place) — this
   changes how the window gets trimmed (see Decision D).
2. **`confirming`**: the creator explicitly requests confirmation. This is
   the point where the trimmed session window (Decision D) gets computed
   from current `yes` RSVPs and stored on the proposal — not recomputed
   live on every read, so it doesn't silently shift under people's feet
   while they're deciding whether to lock in.
3. Each `yes`/`maybe` RSVP holder can then **lock in** (`confirmed = true`)
   against that stored window.
4. **`confirmed`**: the creator still has to explicitly finalize — even
   after people lock in — which is what actually inserts the `play_sessions`
   row (`proposal_id` set, `played_at` = the stored trimmed start). Lock-ins
   are a *signal* the creator uses to decide when to finalize, not a
   mechanical gate that finalizes automatically once everyone's in.
5. **Undo** (from `confirming` or `confirmed` back to `collecting`) resets
   every RSVP's `confirmed` flag to `false`, clears the stored trimmed
   window, and — if a `play_sessions` row already existed — deletes it. A
   `confirmed`-status session backed by an un-confirmed proposal would be an
   inconsistent state with no path back to sanity.

Because: this keeps the "a human still decides" principle from the original
plan, just moved one step later — the trigger for creating the actual
`play_sessions` row is still an explicit creator action, not "N people
clicked yes" or "everyone locked in" (which would need to define what
happens if someone never responds).

Alternative (original plan): a single owner/admin "confirm" action with no
intermediate lock-in stage at all.

Drawback of alternative: doesn't support "ask everyone who said yes/maybe to
explicitly reaffirm before this is real," which is the actual behavior
wanted here.

### Decision D — Computing the trimmed session window

Chose: not a strict intersection across every `yes` window (which is often
empty the moment 3+ people are involved), but the first and last moments
where **at least two** people's windows overlap.

Algorithm (no host): treat each RSVP window as a `[start, +1)`/`[end, -1)`
pair of sweep-line events. Sort by time (processing `end` events before
`start` events at equal timestamps, so touching-but-not-overlapping windows
like `[9,10]` and `[10,11]` don't count as overlapping). Walk the sorted
events tracking a running count of "windows currently open"; the first
moment that count reaches 2 is the trimmed start, the last moment it drops
back below 2 is the trimmed end.

Algorithm (with a designated host): the host's window is mandatory in every
overlap considered — instead of "any two people," it becomes "the host and
at least one other specific person." For each other `yes` RSVP whose window
overlaps the host's at all, clamp it into the host's window
(`[max(host.start, other.start), min(host.end, other.end)]`); the trimmed
start is the earliest such clamped start, the trimmed end is the latest such
clamped end.

Because: this is a pure, easily unit-testable function of a list of
`{ start, end }` windows (see the worked example) — exactly the kind of
logic this codebase's Jest setup (`2_testing`) is suited to cover with a
handful of interval-overlap test cases, independent of the database or
HTTP layer entirely.

Alternative: require every `yes` RSVP's window to overlap simultaneously
(true set intersection across all of them).

Drawback of alternative: with enough participants, there is very often no
single instant every window covers, even though plenty of *pairs* of people
overlap fine — the feature would fail exactly when a group is large enough
to need it most.

### Decision C — iCal feed authentication (revised: per-user, not per-group)

Chose: a long-lived, opaque feed token **per user** (not per group) — same
shape as an invite token (`randomBytes` → raw value shown once, SHA-256
hash stored), but the hash is matched to a `user_id`, not a `group_id` —
passed as a query parameter: `GET /calendar/me.ics?token=<raw>`. This
endpoint deliberately has **no** `@UseGuards(AuthGuard)`. The feed includes
confirmed sessions across every group that user belongs to.

Because: calendar apps poll a plain URL on a timer (Google Calendar's "Add by
URL," Apple Calendar's "Subscribe"). They cannot attach an
`Authorization: Bearer <jwt>` header or hold a login session — the URL
itself is the only credential a calendar client can carry. Per-user (rather
than per-group) also means one calendar subscription shows a member
everything relevant to them, instead of them having to subscribe to a
separate URL per group they're in.

Alternative A: require the same JWT bearer token as every other endpoint.

Drawback: doesn't work at all — no calendar client software supports
attaching custom headers to a subscription URL.

Alternative B: one feed token per group (as originally sketched) rather
than per user.

Drawback: a member in 4 groups would need 4 separate calendar
subscriptions instead of one, and the token would need to be shared
between all members of a group (weakening "who can see this feed" down to
"whoever has the group's one link," rather than each person controlling
their own).

Important difference from invite tokens: a feed token is **not** single-use.
It gets reused every time a calendar app refreshes (hourly, typically), so
"redeem it once and mark it used" (the invite pattern) doesn't apply here —
revocation instead has to be a deliberate "regenerate my feed token" action
that invalidates the old one. Because this endpoint is unauthenticated by
necessity, every request against it also gets a structured log line
(user id it resolved to, IP, timestamp) — not an `audit_log` row (this is a
routine, high-frequency read, not a discrete security event like
`invite.created`), but a Pino log line, the same logging foundation
`2_audit_logging` already established, so abuse (a token being hit from an
unexpected volume or spread of IPs) is at least visible later once
`5_loki` ships log aggregation.

### Decision E — Game proposal upvotes

Chose: a `play_session_proposal_games` row per game proposed for a
proposal (`proposal_id`, `game_id`, `proposed_by`), plus a **separate**
`play_session_proposal_game_votes` join table with
`UNIQUE (proposal_game_id, user_id)`. Upvote count is derived with
`COUNT(*)`, not stored as a column.

Because: this is the exact same double-vote problem the RSVP table
already solves with its own unique constraint — a bare `upvote_count`
integer column has nothing stopping the same user from incrementing it
repeatedly (double-click, retry-on-timeout, or a malicious client just
replaying the request).

Alternative: a single `upvote_count` integer column on
`play_session_proposal_games`, incremented on each upvote request.

Drawback: no way to enforce one-vote-per-user-per-game, and no way to let a
user retract their own vote (decrement by who, exactly, once the count is
just a number with no record of who contributed to it).

### Decision G — Default availability window

Chose: the proposal itself carries `proposed_date` (the calendar day,
chosen up front — e.g. via a date picker — when the proposal is created).
An RSVP only supplies *optional* `availableStart`/`availableEnd` times; if
a `yes`/`maybe` RSVP omits them, the service defaults the window to the
proposal's date at 10:00 through 02:00 the following day — "practically
all day," covering the realistic hours a game night would ever occupy.
Multi-day proposals are explicitly out of scope — a proposal is about one
date, and a host's/attendee's window can spill past midnight into the next
calendar day (the default itself does this), but the proposal doesn't
represent a date *range*.

Because: `PlaySessionRsvp.availableStart`/`availableEnd` being nullable
columns (Decision B/entity design) only says the database doesn't enforce
"yes implies a window" — something still has to guarantee it in practice,
or the overlap computation (Decision D) either crashes or silently drops
that person. Anchoring the date on the proposal (not the RSVP) matches how
this is actually initiated — a member picks a day, then everyone answers
against that one day — and the default time range means answering "yes"
can be a single click ("I'm free that day") without being forced to pick
exact hours, while still always producing a concrete window for Decision D
to consume.

Alternative: require explicit `availableStart`/`availableEnd` always, no
defaulting.

Drawback of alternative: turns "yes, I'm in" into a multi-field form for
the common case of "I have no specific constraint that day" — the whole
point of a lightweight default is to make the easy case easy.

### Decision F — Proposal-scoped chat (deferred)

Not built in this pass. Chat (`Message`, `ChatGateway`) is currently scoped
only at the group level (`group:${groupId}` rooms). Giving each proposal its
own thread would mean a nullable `proposalId` on `Message` and a
`join-proposal` room type in `ChatGateway` — a real change, but one that
touches the already-completed `3_websockets` topic and sits outside this
topic's actual scope (`references/roadmap.md`'s `3_scheduling` entry never
mentions chat). Tracked as a follow-up, not built now.

---

## Worked Example

This is a standalone toy — an in-memory Express app, not this project's
NestJS/TypeORM/Postgres stack — so the RSVP-upsert and ICS-generation shapes
are visible without any framework machinery around them.

### Scenario

A tiny meetup app: propose a date, RSVP to it, confirm it, and expose
confirmed dates as a token-protected `.ics` feed.

### Code / Configuration

```ts
import express from 'express';
import { randomBytes, createHash } from 'crypto';

const app = express();
app.use(express.json());

interface Proposal {
  id: number;
  title: string;
  startsAt: Date;
  status: 'open' | 'confirmed';
}

interface Rsvp {
  proposalId: number;
  userId: string;
  response: 'yes' | 'no' | 'maybe';
}

const proposals: Proposal[] = [];
const rsvps: Rsvp[] = [];
let nextId = 1;

// One fixed token for this toy — a real system generates one per user and
// stores only the hash, exactly like invites.
const FEED_TOKEN = randomBytes(16).toString('hex');
const FEED_TOKEN_HASH = createHash('sha256').update(FEED_TOKEN).digest('hex');

app.post('/proposals', (req, res) => {
  const proposal: Proposal = {
    id: nextId++,
    title: req.body.title,
    startsAt: new Date(req.body.startsAt),
    status: 'open',
  };
  proposals.push(proposal);
  res.status(201).json(proposal);
});

// Upsert by (proposalId, userId): a second RSVP from the same user overwrites
// their previous answer instead of appending a duplicate row. This is the
// application-level mirror of the UNIQUE (proposal_id, user_id) constraint
// the real table enforces at the database level.
app.post('/proposals/:id/rsvp', (req, res) => {
  const proposalId = Number(req.params.id);
  const existing = rsvps.find(
    (r) => r.proposalId === proposalId && r.userId === req.body.userId,
  );
  if (existing) {
    existing.response = req.body.response;
  } else {
    rsvps.push({ proposalId, userId: req.body.userId, response: req.body.response });
  }
  res.sendStatus(204);
});

app.post('/proposals/:id/confirm', (req, res) => {
  const proposal = proposals.find((p) => p.id === Number(req.params.id));
  if (!proposal) return res.sendStatus(404);
  proposal.status = 'confirmed';
  res.sendStatus(204);
});

// The feed itself. Token comes from the query string — NOT a header — and
// is hashed then compared to the one stored hash. No JWT, no cookie: this
// query param is the only credential a calendar client can supply.
app.get('/calendar.ics', (req, res) => {
  const suppliedHash = createHash('sha256')
    .update(String(req.query.token ?? ''))
    .digest('hex');

  if (suppliedHash !== FEED_TOKEN_HASH) {
    return res.sendStatus(403);
  }

  const events = proposals
    .filter((p) => p.status === 'confirmed')
    .map(toIcsEvent)
    .join('\r\n');

  res.set('Content-Type', 'text/calendar');
  res.send(
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//toy-app//EN\r\n${events}\r\nEND:VCALENDAR\r\n`,
  );
});

function toIcsEvent(p: Proposal): string {
  // ICS compact datetime format: YYYYMMDDTHHMMSSZ.
  const stamp = p.startsAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return [
    'BEGIN:VEVENT',
    // UID must be the SAME value every time this event is exported, or every
    // calendar refresh looks like a brand new event instead of an update to
    // an existing one.
    `UID:proposal-${p.id}@toy-app`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${stamp}`,
    `SUMMARY:${p.title}`,
    'END:VEVENT',
  ].join('\r\n');
}

app.listen(3000, () => {
  console.log(`Feed URL: http://localhost:3000/calendar.ics?token=${FEED_TOKEN}`);
});
```

### What Is Happening Step by Step

1. **A proposal is created** via `POST /proposals` — just a title and a
   start time, status starts `'open'`.
2. **Members RSVP** via `POST /proposals/:id/rsvp`. The upsert-by-lookup
   logic (`existing ? update : push`) is the in-memory equivalent of the
   real table's unique constraint — one answer per user per proposal, ever.
3. **Someone confirms it** via `POST /proposals/:id/confirm` — a deliberate,
   separate action, not something that happens automatically based on RSVP
   counts (Decision B).
4. **The feed endpoint checks the token first**, before touching any
   proposal data. Hash the supplied query param, compare to the stored hash,
   403 on mismatch. This runs instead of `AuthGuard`, not alongside it.
5. **Confirmed proposals are turned into ICS text.** Only `status ===
   'confirmed'` proposals appear — RSVP-pending proposals never show up on
   anyone's calendar.
6. **Each proposal becomes one `VEVENT` block** with a stable `UID`, wrapped
   in a single `VCALENDAR` envelope with the required `VERSION` and `PRODID`
   header lines.

### What Would Break If You Changed X?

If `UID` were generated fresh on every request (e.g.
`` `proposal-${Date.now()}` ``) instead of derived from the proposal's stable
id, every calendar refresh would create a **new** duplicate event instead of
recognizing "this is the same session I already have" — Google Calendar and
Apple Calendar both use `UID` as the sole de-duplication key. Users would
end up with the same game night appearing dozens of times.

---

## Now Apply It

The real implementation lives in a new `apps/api/src/scheduling/` module,
plus a small `apps/api/src/calendar/` module for the feed:

- `play-session-proposal.entity.ts` — the proposal table (proposed_date,
  status, host_id), following the bare-column-not-relation pattern already
  used by `Group`, `GroupMember`, and `Invite`.
- `play-session-rsvp.entity.ts` — the RSVP table, with a
  `@Unique(['proposalId', 'userId'])` constraint mirroring
  `group_members`'s `UNIQUE (user_id, group_id)`, plus the availability
  window and `confirmed` columns.
- `play-session-proposal-game.entity.ts` /
  `play-session-proposal-game-vote.entity.ts` — the game-voting pair from
  Decision E.
- `play-session.entity.ts` — finally giving `play_sessions` (which has
  existed in `db/schema.sql` since Phase 2/3 but never had a TypeORM class)
  its entity, including the `proposal_id` FK that `PlayPhoto.sessionId` and
  `db/schema.sql`'s own comments have been forward-referencing.
- `overlap-window.ts` — the pure sweep-line function from Decision D,
  isolated so it can be unit tested without touching the database.
- `scheduling.service.ts` / `scheduling.controller.ts` — propose / RSVP /
  request-confirmation / lock-in / finalize / undo, following
  `GroupsService`'s `assertCanManage`-style role check.
- `calendar-feed-token.entity.ts` / `calendar.controller.ts` — the
  per-user feed, deliberately outside `@UseGuards(AuthGuard)`, following
  `InvitesService`'s hash-at-rest token pattern but without the single-use
  redemption.

Files to look at after this note (once generated):
- `db/schema.sql` — new `play_session_proposals`,
  `play_session_proposal_rsvps`, `play_session_proposal_games`,
  `play_session_proposal_game_votes`, and `calendar_feed_tokens` tables,
  plus the deferred FKs on `play_sessions.proposal_id` and
  `play_photos.session_id` finally getting resolved.
- `apps/api/src/scheduling/` and `apps/api/src/calendar/` — the whole new
  module pair.

---

## Checkpoint Questions

1. Why is `play_session_proposal_rsvps` keyed by a unique
   `(proposal_id, user_id)` pair instead of just appending a new row every
   time someone RSVPs?
2. Why can't the iCal feed endpoint use the same `AuthGuard`/JWT bearer
   pattern as every other endpoint in this API?
3. What's the lifecycle difference between a feed token and an invite token
   — and why does that difference change how each one gets revoked?
4. Walk through what happens, table by table, from "creator requests
   confirmation" through to "play_sessions row exists" — which write
   happens at which status transition, and why is finalizing still a
   separate step from locking in?
5. In the worked example, what specifically breaks if `UID` were regenerated
   randomly on every request instead of derived deterministically from the
   proposal's id?
6. Why does `play_session_proposal_game_votes` need its own table instead of
   just an `upvote_count` column on `play_session_proposal_games`?

---

## Summary

Built: the full scheduling feature — `db/schema.sql` additions
(`play_session_proposals`, `play_session_proposal_rsvps`,
`play_session_proposal_games`, `play_session_proposal_game_votes`,
`calendar_feed_tokens`, plus resolving the long-standing
`play_sessions.proposal_id`/`play_photos.session_id` forward references);
eight TypeORM entities across `apps/api/src/scheduling/` and
`apps/api/src/calendar/`; two pure, unit-tested functions
(`overlap-window.ts` for Decision D's sweep-line trim, `resolve-window.ts`
for Decision G's date+time-of-day defaulting) plus a third
(`build-ics.ts`) for ICS rendering; `SchedulingService` implementing the
full `collecting → confirming → confirmed`/`cancelled` state machine,
host-anchored trimming, per-user lock-in, and game-vote integrity;
`CalendarService`/`CalendarController` for the per-user, token-gated iCal
feed; and 20 passing Jest unit tests. Everything typechecks, builds, and
the existing 58-test suite still passes unchanged.

Demonstrated understanding of: correctly diagnosed the undo-must-delete-
the-session invariant unprompted; independently reasoned through why
`PlaySession.id` could safely become a `uuid` (catching that my own
first-pass justification — "cosmetic consistency isn't worth the FK
churn" — didn't actually hold once no dependent entities existed yet);
converged on the correct sweep-line/all-pairs equivalence for the overlap
algorithm after working through two flawed simplifications (order-
statistics on starts/ends; the "check start > end" patch) and finding the
counterexamples that broke each one; correctly reasoned about composite-
key vote semantics (insert/delete/insert, no update needed); and correctly
traced the write-ordering argument in `undo()` (delete-before-flip) down
to its retry-safety property, not just "avoid an orphan."

To revisit: the multi-day-proposal limitation (Decision G) was
acknowledged as an intentional, revisitable scope cut, not solved —
worth keeping in mind if a real use case (a weekend retreat, a
multi-day con) comes up later. Rate limiting on `/calendar/me.ics` was
correctly identified as a real gap but deliberately deferred to
`4_traefik`, not addressed here — worth confirming it actually lands
there when that topic is built. Proposal-scoped chat (Decision F) remains
a deferred follow-up, not yet scheduled on the roadmap explicitly.
