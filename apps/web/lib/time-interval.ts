const MINUTES_PER_DAY = 24 * 60;

export const TIME_STEP_MINUTES = 15;

export type Period = 'AM' | 'PM';

export interface ClockTime {
  hour: number;
  minute: number;
  period: Period;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function clockToMinutes({ hour, minute, period }: ClockTime): number {
  const hour24 = (hour % 12) + (period === 'PM' ? 12 : 0);
  return hour24 * 60 + minute;
}

export function minutesToClock(minutes: number): ClockTime {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(normalized / 60);
  return {
    hour: hour24 % 12 || 12,
    minute: normalized % 60,
    period: hour24 >= 12 ? 'PM' : 'AM',
  };
}

export function clockPositionMinutes(time: ClockTime): number {
  return (time.hour % 12) * 60 + time.minute;
}

export function intervalDuration(start: string, end: string): number {
  const duration = (timeToMinutes(end) - timeToMinutes(start) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return duration || MINUTES_PER_DAY;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}
