import { IsDateString, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpsertGamePrivateDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  amountPaid?: number | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateAcquired?: string | null;
}
