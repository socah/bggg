import { IsDateString } from 'class-validator';

export class CreateProposalDto {
  // The calendar day this proposal is about (Decision G) — e.g. picked via
  // a date picker in the UI. ISO date string ("2026-07-19"); the time
  // portion, if any, is ignored by SchedulingService.
  @IsDateString()
  proposedDate!: string;
}
