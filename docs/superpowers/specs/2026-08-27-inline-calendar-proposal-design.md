# Inline Calendar Proposal Details

**Date:** 2026-08-27  
**Status:** Approved for planning

## Goal

Make the month calendar the primary place for creating and viewing play-session
proposals. Selecting an empty region of a date opens an unsaved proposal draft;
selecting an existing proposal opens its detail and RSVP controls in the same
location: an inline row immediately below that calendar week.

## Scope

- Remove the calendar-page **+ New proposal** buttons and the side-sheet create
  flow.
- Replace the side-sheet proposal detail view with an inline calendar detail
  row on both the aggregate and group calendar pages.
- Add draft creation from empty areas of calendar dates. Drafts are persisted
  only by the explicit Save action.
- Replace native availability-time inputs with an accessible Material-style
  dial picker.

The scheduling API and proposal data model remain unchanged.

## Calendar Interaction and Layout

`CalendarMonthGrid` will render week rows rather than one flat 42-cell grid.
Each week is still a seven-column grid. When there is a selection, a full-width
detail row is inserted after the selected date's week. Thus, selecting a date
in week four leaves weeks one through four in place and pushes weeks five and
six down below the inline content.

A selection is exactly one of:

- `{ kind: 'proposal', proposalId, dateKey }` for an existing proposal;
- `{ kind: 'draft', dateKey }` for an unsaved new proposal; or
- no selection.

Clicking a proposal badge selects that proposal. Clicking or touching the
empty part of a date cell selects a draft for that date. Badge clicks stop
propagation so they never also select a new draft. The full day-cell target is
keyboard reachable and exposes an explicit accessible label. Adjacent-month
dates behave consistently with the current visible grid and can be selected;
the draft date is the displayed date key.

Selecting a different date or proposal replaces the selection. An unsaved
draft is local React state only, so replacement, month navigation, or unmount
silently discards it without an API request. Existing proposal selection is
not destructive and can be switched freely.

## Inline Content

The inserted row owns the selected surface:

- **Draft:** title/date summary, group choice where required, Save and Cancel.
- **Existing proposal:** the current proposal detail, RSVP, lifecycle, host,
  and game-voting controls.

`ProposalDetailPanel` will become an inline detail component rather than a
Dialog/side sheet. It retains its existing fetch/refetch and mutation behavior;
the parent refreshes month data after successful actions. Closing the inline
detail clears the grid selection.

The draft form will use the selected date as a fixed, visible value rather than
another date input. On a group calendar its group is preselected and cannot be
changed. On the aggregate calendar it provides the same group select currently
used by the dialog; no implicit fallback is applied when there are no groups.
Save validates that a group is chosen, POSTs the existing
`/groups/:groupId/proposals` endpoint with the selected `YYYY-MM-DD` date, then
replaces the draft selection with the created proposal and refreshes badges.
Failed saves leave the draft and display an inline error.

The old `CreateProposalDialog` is removed if it has no other consumers.

## Material-Style Time Dial

A reusable controlled `TimeDialPicker` accepts an `HH:mm` value and callback.
Opening it presents a Material-inspired dialog/popover with:

- a digital selected-time display;
- a clock-face dial for choosing hour, then minute;
- keyboard-operable hour/minute controls and an accessible text alternative;
- Cancel and Apply actions that prevent partial edits from being committed.

The picker uses a 24-hour clock and returns a zero-padded `HH:mm` value, which
matches the existing RSVP API contract. `ProposalRsvpSection` will use two
instances for available-from and available-until. Its current all-or-neither
validation, default-window behavior, and UTC copy stay unchanged.

## Component Boundaries

| Component | Responsibility |
| --- | --- |
| `CalendarMonthGrid` | Month navigation, day/proposal selection, week-row insertion, selection state callback. |
| Calendar page / `GroupCalendarView` | Owns selected inline content, supplies aggregate groups or fixed group, and refreshes proposal lists. |
| `CreateProposalInlineForm` | Holds an unsaved draft, validates and saves it, with no server state before Save. |
| `ProposalDetailPanel` (renamed or refactored) | Existing proposal details and actions, rendered inline. |
| `TimeDialPicker` | Accessible controlled Material-style time selection. |

Selection state remains in calendar-page parents so aggregate/group context and
refresh callbacks do not leak into the grid. The grid receives a renderable
inline slot keyed to the selected week, avoiding position calculations and
preserving responsive flow layout.

## Error Handling

- Detail fetch and mutation errors remain inline with Retry where currently
  supported.
- Draft creation errors display in the draft form and do not discard entered
  group selection.
- A draft with no available group disables Save and explains why.
- A cancelled or no-longer-available selected proposal retains the existing
  muted/not-found treatment; the user can select another date immediately.

## Verification

- Add focused unit tests for calendar week placement and selection callbacks,
  including insertion after the first, middle, and final week and badge-click
  selection versus empty-cell draft selection.
- Add component tests if a supported frontend test harness is available;
  otherwise cover these paths in the documented manual walkthrough.
- Add tests for the time picker's `HH:mm` conversion, Apply/Cancel behavior,
  and keyboard controls.
- Run `npm run lint` and `npm run build` from `apps/web`.
- Manually verify aggregate and group calendar flows: draft discard on switching
  dates, group preselection, save/error states, existing proposal inline
  details, a six-row month insertion after week four, touch selection, and
  RSVP availability save via the dial.
