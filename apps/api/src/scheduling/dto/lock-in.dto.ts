import { IsBoolean } from 'class-validator';

// A member can lock in (confirmed: true) or withdraw a lock-in they
// already gave (confirmed: false) while a proposal is 'confirming' — see
// SchedulingService.lockIn.
export class LockInDto {
  @IsBoolean()
  confirmed!: boolean;
}
