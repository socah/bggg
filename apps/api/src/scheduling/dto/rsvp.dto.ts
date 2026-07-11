import { IsIn, IsOptional, Matches } from 'class-validator';
import { RsvpStatus } from '../play-session-rsvp.entity';

// 24-hour "HH:mm", e.g. "18:00" — not a full datetime. The date always
// comes from the proposal's own proposedDate (Decision G); a member only
// ever supplies a time-of-day, never a competing date.
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class RsvpDto {
  @IsIn(['yes', 'maybe', 'no'])
  status!: RsvpStatus;

  // Both optional — omitted entirely for 'no' (no window to give), and
  // optional for 'yes'/'maybe' too: SchedulingService fills in the
  // Decision G default (10:00 through 02:00 the next day) when a member
  // just wants to say "I'm free that day" without picking exact hours.
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'availableStart must be in HH:mm 24-hour format' })
  availableStart?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'availableEnd must be in HH:mm 24-hour format' })
  availableEnd?: string;
}
