import { describe, expect, it } from '@jest/globals';
import { formatDateDmy } from './datetime';

describe('formatDateDmy', () => {
  it('formats bare and timestamp dates as day/month/year', () => {
    expect(formatDateDmy('2026-09-03')).toBe('03/09/2026');
    expect(formatDateDmy('2026-09-03T20:00:00.000Z')).toBe('03/09/2026');
  });
});
