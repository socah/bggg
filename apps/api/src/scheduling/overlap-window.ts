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
// Without a host: the first and last moments where AT LEAST TWO people's
// windows overlap — not a strict intersection across every window, which
// is very often empty once 3+ people are involved even though plenty of
// individual pairs overlap fine.
//
// With a host: the host's window is mandatory in every overlap considered
// — "the host and at least one other specific person," not "any two
// people" — since the session is happening at the host's place and can't
// run outside the host's own availability.
export function computeOverlapWindow(
  windows: AvailabilityWindow[],
  hostUserId: string | null,
): { start: Date; end: Date } {
  if (hostUserId) {
    return computeHostAnchoredWindow(windows, hostUserId);
  }
  return computeAnyPairWindow(windows);
}

function computeHostAnchoredWindow(
  windows: AvailabilityWindow[],
  hostUserId: string,
): { start: Date; end: Date } {
  const host = windows.find((w) => w.userId === hostUserId);
  if (!host) {
    throw new NoOverlapError('Host has no yes RSVP with a window');
  }

  // Clamp each other window into the host's — the overlap can never extend
  // past whichever of the two boundaries is tighter.
  const clamped = windows
    .filter((w) => w.userId !== hostUserId)
    .filter((w) => w.start.getTime() < host.end.getTime() && w.end.getTime() > host.start.getTime())
    .map((w) => ({
      start: new Date(Math.max(host.start.getTime(), w.start.getTime())),
      end: new Date(Math.min(host.end.getTime(), w.end.getTime())),
    }));

  if (clamped.length === 0) {
    throw new NoOverlapError("No RSVP window overlaps with the host's window");
  }

  return {
    start: new Date(Math.min(...clamped.map((w) => w.start.getTime()))),
    end: new Date(Math.max(...clamped.map((w) => w.end.getTime()))),
  };
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
