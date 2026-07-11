// Turns a proposal's calendar date plus optional HH:mm time-of-day inputs
// into concrete Date objects — the Decision G default-window logic. Kept
// separate from overlap-window.ts: that file compares many windows against
// each other, this one builds a single window from one RSVP's inputs. Pure
// for the same reason — unit-testable without touching TypeORM or HTTP.

const DEFAULT_START_TIME = '10:00';
const DEFAULT_END_TIME = '02:00';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function combineDateAndTime(proposedDate: string, time: string): Date {
  if (!TIME_PATTERN.test(time)) {
    throw new Error(`Invalid time-of-day: ${time}`);
  }

  const [hours, minutes] = time.split(':').map(Number);

  // Built in UTC deliberately. proposedDate is a bare "YYYY-MM-DD" string
  // with no timezone of its own, and every other timestamp in this app is
  // TIMESTAMPTZ under the hood. Combining via the server's LOCAL timezone
  // instead would make the exact same inputs produce a different instant
  // depending on where the API process happens to be deployed.
  const combined = new Date(`${proposedDate}T00:00:00.000Z`);
  combined.setUTCHours(hours, minutes, 0, 0);
  return combined;
}

export function resolveAvailabilityWindow(
  proposedDate: string,
  startTime: string | undefined,
  endTime: string | undefined,
): { start: Date; end: Date } {
  const start = combineDateAndTime(proposedDate, startTime ?? DEFAULT_START_TIME);
  let end = combineDateAndTime(proposedDate, endTime ?? DEFAULT_END_TIME);

  // An end time-of-day that's numerically at or before the start (the
  // default "02:00", or an explicit late-night value like "01:30") spills
  // into the next calendar day — the same way a real game night runs past
  // midnight without becoming a different day's proposal.
  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return { start, end };
}
