import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  chatMessages?: boolean;

  @IsOptional()
  @IsBoolean()
  proposalUpdates?: boolean;

  @IsOptional()
  @IsBoolean()
  showMessagePreviews?: boolean;
}
