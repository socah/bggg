import { resolveAvailabilityWindow } from './resolve-window';

const PROPOSED_DATE = '2026-07-19';

describe('resolveAvailabilityWindow', () => {
  it('combines explicit HH:mm times with the proposal date', () => {
    const result = resolveAvailabilityWindow(PROPOSED_DATE, '18:00', '23:00');

    expect(result.start.toISOString()).toBe('2026-07-19T18:00:00.000Z');
    expect(result.end.toISOString()).toBe('2026-07-19T23:00:00.000Z');
  });

  it('defaults to 10:00 through 02:00 the next day when no times are given (Decision G)', () => {
    const result = resolveAvailabilityWindow(PROPOSED_DATE, undefined, undefined);

    expect(result.start.toISOString()).toBe('2026-07-19T10:00:00.000Z');
    // The default end (02:00) is numerically before the default start
    // (10:00), so it spills into the next calendar day — this is what
    // makes the window span "practically all day" rather than being
    // inverted (a 2:00 end ON the 19th would be before the start).
    expect(result.end.toISOString()).toBe('2026-07-20T02:00:00.000Z');
  });

  it('spills an explicit end time into the next day when it is at or before the start time', () => {
    // A game night that runs from 22:00 to 01:00 — 01:00 has to mean
    // "the next calendar day," not an inverted window earlier the same day.
    const result = resolveAvailabilityWindow(PROPOSED_DATE, '22:00', '01:00');

    expect(result.start.toISOString()).toBe('2026-07-19T22:00:00.000Z');
    expect(result.end.toISOString()).toBe('2026-07-20T01:00:00.000Z');
  });

  it('spills to the next day even when start and end times are identical', () => {
    const result = resolveAvailabilityWindow(PROPOSED_DATE, '09:00', '09:00');

    expect(result.start.toISOString()).toBe('2026-07-19T09:00:00.000Z');
    expect(result.end.toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });

  it('only defaults the side that was omitted, not both', () => {
    // Explicit start, default end — the default end (02:00) is still
    // computed against PROPOSED_DATE first, then spills forward because
    // it's before the explicit start.
    const result = resolveAvailabilityWindow(PROPOSED_DATE, '20:00', undefined);

    expect(result.start.toISOString()).toBe('2026-07-19T20:00:00.000Z');
    expect(result.end.toISOString()).toBe('2026-07-20T02:00:00.000Z');
  });
});
