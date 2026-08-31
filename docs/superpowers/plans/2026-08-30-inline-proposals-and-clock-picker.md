# Calendar Inline Proposals & Material Design Time Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the proposal creation and calendar browsing workflow to use an inline week-row expander instead of a side sheet panel, enable proposal creation by clicking empty date cells in the calendar grid, auto-discard uncommitted drafts on navigation, auto-assign active group context, and provide a Material Design 3 radial dial clock picker for RSVP hours.

**Architecture:** Split the calendar grid into 7-day week rows with an accordion expander container rendered beneath the active week. Refactor proposal detail and creation views into inline components hosted within the calendar expander. Implement a standalone Material Design 3 clock dial picker component for time selection in RSVPs.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind CSS, Radix UI Dialog primitives.

**Spec:** `docs/superpowers/specs/2026-08-30-inline-proposals-and-clock-picker-design.md`

## Global Constraints

- Never break existing scheduling APIs or data contracts (`/groups/:groupId/proposals`, `/proposals/:id/rsvp`, etc.).
- Maintain clean TypeScript compilation without warnings or errors.
- Ensure all interactive elements have appropriate ARIA attributes and keyboard accessibility.
- Automatic draft discarding when switching active date selection or navigating away.

---

### Task 1: Create Material Design 3 Dial Time Picker Component

**Files:**
- Create: `apps/web/components/ui/time-picker-dialog.tsx`

**Interfaces:**
- Consumes: `@/components/ui/dialog` (Radix Dialog primitives), `@/components/ui/button`
- Produces: `TimePickerDialog({ open, value, onOpenChange, onConfirm, title }: TimePickerDialogProps)`

- [ ] **Step 1: Write `TimePickerDialog` component**

Create `apps/web/components/ui/time-picker-dialog.tsx` with:
- State for `mode` ('hours' | 'minutes')
- State for `hour` (1..12), `minute` (0..59), and `period` ('AM' | 'PM')
- Parse initial `value` (in `HH:mm` 24h format) into `hour`, `minute`, and `period`
- Interactive SVG or absolute-positioned dial clock face (radius 100-120px):
  - 12 dial numbers for hours (1..12) at 30° intervals
  - 12 dial numbers for minutes (00, 05, 10... 55) at 30° intervals
  - Pointer hand drawn from center to the selected angle
  - Drag and click coordinate calculations using `Math.atan2` for selecting angles
  - Automatic transition from `hours` mode to `minutes` mode after selecting an hour
- Digital display header allowing switching between hours and minutes modes and toggling AM/PM
- Cancel and OK action buttons emitting formatted `HH:mm` (24h) string on confirm

- [ ] **Step 2: Verify type correctness & lint**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/time-picker-dialog.tsx
git commit -m "feat: add Material Design 3 dial time picker dialog component"
```

---

### Task 2: Integrate Time Picker Dialog into RSVP Hour Selection

**Files:**
- Modify: `apps/web/components/proposal-rsvp-section.tsx`

**Interfaces:**
- Consumes: `TimePickerDialog` from `@/components/ui/time-picker-dialog`
- Produces: Updated `ProposalRsvpSection` where "Available from" and "Available until" open the dial time picker

- [ ] **Step 1: Update `ProposalRsvpSection` to use `TimePickerDialog`**

In `apps/web/components/proposal-rsvp-section.tsx`:
- Replace native `<input type="time" ... />` elements with trigger buttons that show the selected time or a placeholder (e.g. `startInput || 'Start time'`).
- Add state for `timePickerTarget`: `'start' | 'end' | null`.
- Open `TimePickerDialog` when clicking either time trigger button.
- On confirm, update `startInput` or `endInput` and close the dialog.

- [ ] **Step 2: Verify lint & build**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/proposal-rsvp-section.tsx
git commit -m "feat: integrate Material Design dial time picker into RSVP hours selection"
```

---

### Task 3: Build Inline Proposal Detail Component

**Files:**
- Create: `apps/web/components/inline-proposal-detail.tsx`

**Interfaces:**
- Consumes: `useProposalDetail`, `useGroupMembers`, `useProposalActions`, `ProposalRsvpSection`, `ProposalGamesSection`, `ProposalLifecycleActions`
- Produces: `InlineProposalDetail({ proposalId, onClose, onChanged }: InlineProposalDetailProps)`

- [ ] **Step 1: Create `InlineProposalDetail` component**

Extract the inner content of `ProposalDetailPanel` (which was wrapped in a Radix sheet) into an inline container component with:
- Top bar with date, status badge, and close "✕" button
- Creator and host details
- `ProposalRsvpSection`
- RSVP list with "Make host" / "Clear host" actions
- `ProposalGamesSection`
- `ProposalLifecycleActions`
- Proper padding, background styling (`bg-surface-raised border border-border rounded-md p-4`) suitable for inline expansion.

- [ ] **Step 2: Verify lint**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inline-proposal-detail.tsx
git commit -m "feat: add inline proposal detail component"
```

---

### Task 4: Build Inline Proposal Draft Component

**Files:**
- Create: `apps/web/components/inline-create-proposal.tsx`

**Interfaces:**
- Consumes: `apiMutate` from `@/lib/api`, `Group`, `Proposal` from `@/lib/types`
- Produces: `InlineCreateProposal({ date, groups, defaultGroupId, onCreated, onCancel }: InlineCreateProposalProps)`

- [ ] **Step 1: Create `InlineCreateProposal` component**

Implement `apps/web/components/inline-create-proposal.tsx`:
- State for `groupId`, `pending`, `error`
- Formatted date display header (e.g. `new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })`)
- Group selection:
  - If `defaultGroupId` is present, display group name statically (or single group label).
  - If `defaultGroupId` is not present, render `<select>` dropdown with all user's groups.
- "Save proposal" button (submits `POST /groups/:groupId/proposals` with `{ proposedDate: date }`).
- "Cancel" button (calls `onCancel()`).
- Error message display.

- [ ] **Step 2: Verify lint**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inline-create-proposal.tsx
git commit -m "feat: add inline proposal creation draft component"
```

---

### Task 5: Refactor `CalendarMonthGrid` for Week-Row Partitioning & Inline Expanders

**Files:**
- Modify: `apps/web/components/calendar-month-grid.tsx`

**Interfaces:**
- Consumes: `InlineCreateProposal`, `InlineProposalDetail`, `buildMonthGrid`, `toDateKey`, `placementDateKey`
- Produces: Updated `CalendarMonthGrid({ proposals, groups, defaultGroupId, onProposalsChanged }: CalendarMonthGridProps)`

- [ ] **Step 1: Update `CalendarMonthGrid` implementation**

In `apps/web/components/calendar-month-grid.tsx`:
- Chunk `grid` (`CalendarDay[]`) into weeks of 7 days: `weeks = Array.from({ length: grid.length / 7 }, (_, i) => grid.slice(i * 7, (i + 1) * 7))`.
- State for `activeSelection`:
  - `null`
  - `{ type: 'draft', date: string }`
  - `{ type: 'proposal', proposalId: string, date: string }`
- Find which week row contains the active selection's `date`.
- Cell click handler:
  - If user clicks an empty area in a date cell, set `activeSelection = { type: 'draft', date: toDateKey(day.date) }`.
  - If user clicks an existing proposal badge, call `e.stopPropagation()` and set `activeSelection = { type: 'proposal', proposalId: item.id, date: placementDateKey(item) }`.
- In the JSX:
  - Map each `week` to a container.
  - Render the 7 day cells in a `grid grid-cols-7 gap-1`.
  - If `activeWeekIndex === weekIndex`, render the inline expander slot directly below the week grid:
    - If `type === 'draft'`, render `<InlineCreateProposal ... />`
    - If `type === 'proposal'`, render `<InlineProposalDetail ... />`
- When proposal is created in draft form:
  - Notify parent to refresh proposals via `onProposalsChanged()`.
  - Set `activeSelection = { type: 'proposal', proposalId: created.id, date: created.proposedDate }`.
- When proposal is updated or closed:
  - On close: set `activeSelection = null`.
  - On changed: call `onProposalsChanged()`.

- [ ] **Step 2: Verify lint & compilation**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/calendar-month-grid.tsx
git commit -m "feat: refactor CalendarMonthGrid to partition into week rows with inline expander"
```

---

### Task 6: Update Group and Personal Calendar Pages

**Files:**
- Modify: `apps/web/components/group-calendar-view.tsx`
- Modify: `apps/web/app/(shell)/calendar/page.tsx`

**Interfaces:**
- Consumes: Updated `CalendarMonthGrid` with `groups`, `defaultGroupId`, and `onProposalsChanged` props
- Removes: Top "+ New proposal" buttons, side sheet `ProposalDetailPanel` and `CreateProposalDialog` modal wrappers

- [ ] **Step 1: Update `GroupCalendarView` (`apps/web/components/group-calendar-view.tsx`)**
  - Remove "+ New proposal" button from the header.
  - Pass `groups` (or fallback `{ id: groupId, ... }`), `defaultGroupId={groupId}`, and `onProposalsChanged={refreshAll}` to `CalendarMonthGrid`.
  - Remove `ProposalDetailPanel` and `CreateProposalDialog` JSX.

- [ ] **Step 2: Update `PersonalCalendarPage` (`apps/web/app/(shell)/calendar/page.tsx`)**
  - Remove "+ New proposal" button from the header.
  - Pass `groups` and `onProposalsChanged={retry}` to `CalendarMonthGrid`.
  - Remove `ProposalDetailPanel` and `CreateProposalDialog` JSX.

- [ ] **Step 3: Verify lint & build**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/group-calendar-view.tsx apps/web/app/\(shell\)/calendar/page.tsx
git commit -m "feat: wire inline calendar proposal interactions on group and personal calendar views"
```

---

### Task 7: Verification & Build Check

**Files:**
- Verify all modified and created files across `apps/web`.

- [ ] **Step 1: Run full lint across workspace**

Run: `npm run lint --workspace=apps/web`
Expected: 0 errors

- [ ] **Step 2: Run full build across workspace**

Run: `npm run build --workspace=apps/web`
Expected: Successful compilation of all routes and client bundles

- [ ] **Step 3: Commit any final cleanup**

```bash
git status
# If clean or any cleanup files:
git commit -m "chore: verify build and lint passing for inline calendar proposals"
```
