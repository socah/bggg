import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class PlayPlayersQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  playedDate?: string;

  @IsOptional()
  @IsUUID()
  proposalId?: string;
}
