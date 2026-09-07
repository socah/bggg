import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateListGameDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tier?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
