// Isolated on purpose: this is the one piece of genuinely non-trivial logic
// in the scheduling feature, and it doesn't touch TypeORM, HTTP, or
// anything else that would make it awkward to unit test. See
// notes/3_scheduling.md Decision D for the full reasoning.

export interface AvailabilityWindow {
  userId: string;
  start: Date;
  end: Date;
}

export class NoOverlapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOverlapError';
  }
}

// Computes the trimmed session window from a set of 'yes' RSVP windows.
//
// A sole attendee keeps their complete window. Otherwise, without a host:
// the first and last moments where AT LEAST TWO people's windows overlap —
// not a strict intersection across every window, which is very often empty
// once 3+ people are involved even though plenty of pairs overlap fine.
//
// With hosts: a sole attendee must be a host. For multiple attendees, every
// valid portion must involve at least two attendees and at least one owner of
// a suggested place. The returned range is the outer envelope of all such
// portions, matching the existing no-host semantics.
export function computeOverlapWindow(
  windows: AvailabilityWindow[],
  hostUserIds: readonly string[],
): { start: Date; end: Date } {
  if (windows.length === 1) {
    const [window] = windows;
    if (hostUserIds.length > 0 && !hostUserIds.includes(window.userId)) {
      throw new NoOverlapError('The only attendee is not an owner of a suggested place');
    }
    return { start: window.start, end: window.end };
  }
  if (hostUserIds.length > 0) {
    return computeHostInvolvingWindow(windows, new Set(hostUserIds));
  }
  return computeAnyPairWindow(windows);
}

function computeHostInvolvingWindow(
  windows: AvailabilityWindow[],
  hostUserIds: Set<string>,
): { start: Date; end: Date } {
  type SweepEvent = { time: number; starts: boolean; userId: string };
  const events: SweepEvent[] = windows.flatMap((window) => [
    { time: window.start.getTime(), starts: true, userId: window.userId },
    { time: window.end.getTime(), starts: false, userId: window.userId },
  ]);
  events.sort((a, b) => a.time - b.time || Number(a.starts) - Number(b.starts));

  const active = new Set<string>();
  let validFrom: number | null = null;
  let firstOverlap: number | null = null;
  let lastOverlap: number | null = null;
  for (const event of events) {
    const wasValid = active.size >= 2 && [...active].some((id) => hostUserIds.has(id));
    if (event.starts) active.add(event.userId);
    else active.delete(event.userId);
    const isValid = active.size >= 2 && [...active].some((id) => hostUserIds.has(id));
    if (!wasValid && isValid) validFrom = event.time;
    if (wasValid && !isValid && validFrom !== null) {
      firstOverlap ??= validFrom;
      lastOverlap = event.time;
      validFrom = null;
    }
  }

  if (firstOverlap === null || lastOverlap === null) {
    throw new NoOverlapError('No RSVP overlap involves an owner of a suggested place');
  }
  return { start: new Date(firstOverlap), end: new Date(lastOverlap) };
}

function computeAnyPairWindow(windows: AvailabilityWindow[]): { start: Date; end: Date } {
  type SweepEvent = { time: number; delta: 1 | -1 };

  const events: SweepEvent[] = windows.flatMap((w) => [
    { time: w.start.getTime(), delta: 1 },
    { time: w.end.getTime(), delta: -1 },
  ]);

  // Process 'end' events before 'start' events at equal timestamps, so
  // touching-but-not-overlapping windows (e.g. [9,10] and [10,11]) don't
  // count as overlapping — sorting delta ascending puts -1 before +1.
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);

  let openCount = 0;
  let firstOverlap: number | null = null;
  let lastOverlap: number | null = null;

  for (const event of events) {
    const before = openCount;
    openCount += event.delta;

    if (before < 2 && openCount >= 2 && firstOverlap === null) {
      firstOverlap = event.time;
    }
    if (before >= 2 && openCount < 2) {
      lastOverlap = event.time;
    }
  }

  if (firstOverlap === null || lastOverlap === null) {
    throw new NoOverlapError('No two RSVP windows overlap');
  }

  return { start: new Date(firstOverlap), end: new Date(lastOverlap) };
}
