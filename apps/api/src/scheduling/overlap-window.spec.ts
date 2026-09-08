import { computeOverlapWindow, NoOverlapError, AvailabilityWindow } from './overlap-window';

// Fixed base day so every test works in whole hours instead of real
// timestamps — easier to eyeball than epoch milliseconds. Matches how
// RSVP windows actually get built (resolve-window.ts combines a proposal's
// date with an HH:mm time), just spelled out by hand here.
const hour = (h: number, m = 0): Date => new Date(Date.UTC(2026, 0, 1, h, m));

function window(userId: string, startHour: number, endHour: number): AvailabilityWindow {
  return { userId, start: hour(startHour), end: hour(endHour) };
}

describe('computeOverlapWindow', () => {
  describe('without a host (any two people)', () => {
    it('returns the first/last moment two windows overlap', () => {
      const windows = [window('a', 9, 11), window('b', 10, 12)];

      const result = computeOverlapWindow(windows, []);

      expect(result).toEqual({ start: hour(10), end: hour(11) });
    });

    it('throws when two windows only touch, without overlapping', () => {
      // [9,10) and [10,11) — half-open intervals, so touching at 10:00
      // does not count as overlapping. This is the tie-break behavior:
      // the 'end' event at 10:00 is processed before the 'start' event at
      // 10:00, so the open count never reaches 2.
      const windows = [window('a', 9, 10), window('b', 10, 11)];

      expect(() => computeOverlapWindow(windows, [])).toThrow(NoOverlapError);
    });

    it('throws when no two windows overlap at all', () => {
      const windows = [window('a', 9, 10), window('b', 12, 13)];

      expect(() => computeOverlapWindow(windows, [])).toThrow(NoOverlapError);
    });

    it('returns the outer envelope across a staggered three-way overlap', () => {
      // A=[1,5), B=[3,7), C=[6,9). A∩B=[3,5), B∩C=[6,7) — two separate
      // overlapping pairs with a one-hour gap (5-6) where only B is open.
      // The function returns the OUTER envelope [3,7), not the disjoint
      // union — see Decision D's "first/last moment ANY pair overlaps",
      // not a guarantee of continuous 2+ coverage throughout.
      const windows = [window('a', 1, 5), window('b', 3, 7), window('c', 6, 9)];

      const result = computeOverlapWindow(windows, []);

      expect(result).toEqual({ start: hour(3), end: hour(7) });
    });

    it('uses the sole attendee window when only one is given', () => {
      const windows = [window('a', 9, 17)];

      expect(computeOverlapWindow(windows, [])).toEqual({ start: hour(9), end: hour(17) });
    });
  });

  describe('with owners of suggested places', () => {
    it('clamps the window to where the host overlaps another single person', () => {
      const host = window('host', 10, 14);
      const other = window('other', 13, 16);

      const result = computeOverlapWindow([host, other], ['host']);

      expect(result).toEqual({ start: hour(13), end: hour(14) });
    });

    it('ignores a window that never overlaps the host at all', () => {
      const host = window('host', 10, 14);
      const overlapping = window('other', 13, 16);
      const distant = window('bystander', 16, 18); // starts exactly when host ends

      const result = computeOverlapWindow([host, overlapping, distant], ['host']);

      // Same result as the two-person case above — 'bystander' contributes
      // nothing because their window doesn't overlap the host's at all.
      expect(result).toEqual({ start: hour(13), end: hour(14) });
    });

    it('throws when nobody else overlaps the host', () => {
      const host = window('host', 10, 14);
      const distant = window('other', 16, 18);

      expect(() => computeOverlapWindow([host, distant], ['host'])).toThrow(NoOverlapError);
    });

    it('throws when the designated host has no window in the list', () => {
      // e.g. the host's own RSVP was 'maybe' or 'no', so it was filtered
      // out before this function was ever called (SchedulingService only
      // passes 'yes' RSVPs with a real window in).
      const other = window('other', 13, 16);

      expect(() => computeOverlapWindow([other], ['host'])).toThrow(NoOverlapError);
    });

    it('uses a sole attendee window when that attendee owns a suggested place', () => {
      const host = window('host', 10, 14);

      expect(computeOverlapWindow([host], ['host'])).toEqual({ start: hour(10), end: hour(14) });
    });

    it('uses the widest valid overlap involving any derived host', () => {
      const windows = [
        window('host-a', 9, 12),
        window('guest-a', 10, 11),
        window('host-b', 14, 18),
        window('guest-b', 15, 17),
      ];

      expect(computeOverlapWindow(windows, ['host-a', 'host-b'])).toEqual({
        start: hour(10),
        end: hour(17),
      });
    });
  });
});
