# Design Specification: Calendar Inline Proposals & Material Design Time Picker

- **Date**: 2026-08-30
- **Status**: Approved Design

## 1. Overview
This specification updates the proposal creation and calendar browsing workflow across the web application:
1. **Remove '+ New proposal' top button**: Creation is now initiated directly by clicking an empty region of a date cell in the calendar.
2. **Inline Week-Row Expander**: The proposal overview (for existing proposals) and new proposal draft form (for clicked empty days) expand inline between calendar week rows, pushing lower rows down instead of opening a modal side sheet dialog.
3. **Auto-discard & Save Lifecycle**: Opening another date or navigating away discards unsaved proposal drafts. Saving creates the proposal and immediately switches to viewing the created proposal inline.
4. **Group Context Inheritance**: Creating a proposal while in a group space automatically associates the proposal with that active group. In personal/aggregate space, a group selector dropdown allows selecting the target group.
5. **Material Design Dial Time Picker**: An interactive Material Design 3 radial clock dial picker dialog replaces native time inputs for RSVP hour specification.

---

## 2. Component Architecture & UI Flow

### 2.1 Week-Partitioned Calendar Grid (`apps/web/components/calendar-month-grid.tsx`)
- **Structure**:
  - `buildMonthGrid(monthAnchor)` returns all `CalendarDay[]` for the month (including padding).
  - The days array is partitioned into 7-day subarrays (weeks).
  - Each week is rendered in its own container with a 7-column day grid, followed by a conditional inline expander container.
- **Selection State**:
  - `activeSelection`:
    - `null`: No expander open.
    - `{ type: 'draft', date: string, groupId?: string }`: Inline new proposal creation form open for the specified date.
    - `{ type: 'proposal', proposalId: string, date: string }`: Inline proposal detail overview open for the specified proposal.
- **Interactions**:
  - **Cell Click (empty region)**: Sets `activeSelection` to `{ type: 'draft', date: cellDateKey, groupId: defaultGroupId }`.
  - **Badge Click**: Event stops propagation, sets `activeSelection` to `{ type: 'proposal', proposalId: item.id, date: placementDateKey(item) }`.
  - **Row Transition**: If clicking a date on the same row, the expander updates its contents in place. If clicking a date in another row, the previous row unmounts and the new row mounts.

### 2.2 Inline Proposal Draft Component (`apps/web/components/inline-create-proposal.tsx`)
- **Props**:
  - `date`: `string` (`YYYY-MM-DD`)
  - `groups`: `Group[]`
  - `defaultGroupId?: string`
  - `onCreated`: `(proposal: Proposal) => void`
  - `onCancel`: `() => void`
- **Fields**:
  - Date display (formatted e.g. "Friday, September 18, 2026").
  - Group context:
    - If `defaultGroupId` is provided (group page), renders the group name as static context.
    - If `defaultGroupId` is not provided (personal page), renders a `<select>` dropdown containing the user's groups.
- **Actions**:
  - **"Save proposal"** button: calls `POST /groups/:groupId/proposals` with `{ proposedDate: date }`.
  - **"Cancel"** button: invokes `onCancel()`, which clears `activeSelection`.
  - Shows inline error message on API failure.

### 2.3 Inline Proposal Detail Component (`apps/web/components/inline-proposal-detail.tsx`)
- **Props**:
  - `proposalId`: `string`
  - `onClose`: `() => void`
  - `onChanged`: `() => void`
- **Contents**:
  - Displays proposal date, status, creator, host info.
  - Hosts RSVP response controls (`ProposalRsvpSection`).
  - Hosts RSVP list & "Make host / Clear host" management.
  - Hosts game suggestions (`ProposalGamesSection`).
  - Hosts lifecycle action buttons (`ProposalLifecycleActions` — Request confirmation, Finalize, Undo, Cancel).
  - Close "✕" button in header to dismiss the inline expander.

### 2.4 Material Design 3 Dial Time Picker (`apps/web/components/ui/time-picker-dialog.tsx`)
- **Props**:
  - `open`: `boolean`
  - `value`: `string` (`HH:mm` in 24h format, or empty)
  - `onOpenChange`: `(open: boolean) => void`
  - `onConfirm`: `(time: string) => void`
  - `title?: string`
- **Visual Design**:
  - Dialog overlay modal.
  - Header with large digital time display (`HH` and `MM` clickable buttons to switch modes) and AM/PM toggles.
  - Clock face (radial dial, radius 120px):
    - 12 numbers evenly positioned at 30-degree intervals.
    - Hours mode (1..12).
    - Minutes mode (00, 05, 10..55) with 1-minute click/drag precision.
    - Central pin, clock pointer line, and circular selected node indicator.
  - Actions: "Cancel" and "OK" buttons.
- **RSVP Integration**:
  - In `apps/web/components/proposal-rsvp-section.tsx`, replace the native `<input type="time" ...>` elements for start and end times with trigger buttons that open `TimePickerDialog`.

---

## 3. Data Flow & State Management

1. **Page Load**:
   - `PersonalCalendarPage` / `GroupCalendarView` fetches proposals via `useAggregateProposals()` / `useGroupProposals()`.
2. **User Clicks Empty Day**:
   - `CalendarMonthGrid` sets `activeSelection = { type: 'draft', date: '2026-09-18', groupId: currentGroupId }`.
   - Expander renders below the target week's row.
3. **User Saves Proposal**:
   - `InlineCreateProposal` sends `POST /groups/:groupId/proposals`.
   - Parent refreshes proposals query (`retry()`).
   - `activeSelection` updates to `{ type: 'proposal', proposalId: created.id, date: created.proposedDate }`.
4. **User Interacts with RSVP Hours**:
   - Opens "Specify hours" in RSVP section.
   - Clicks "Available from" or "Available until" button.
   - `TimePickerDialog` opens with dial clock face.
   - User picks hour, automatically shifts to minute dial, picks minute, taps OK.
   - Time string `HH:mm` updates local RSVP state.
   - "Save hours" commits the RSVP with custom hours to `PUT /proposals/:id/rsvp`.

---

## 4. Testing & Verification

- **Lint & Build Verification**:
  - Run `npm run lint` and `npm run build` in `apps/web`.
- **Manual & Automated Component Verification**:
  - Verify clicking an empty date expands inline below that week.
  - Verify clicking a date on another week collapses the previous row and expands the new row.
  - Verify group page auto-selects group; personal page shows group dropdown.
  - Verify saving proposal creates and shows proposal details inline.
  - Verify clicking another date or canceling discards draft.
  - Verify Material Design clock dial opens, supports hour & minute selection, and saves correctly in RSVP specify hours.
