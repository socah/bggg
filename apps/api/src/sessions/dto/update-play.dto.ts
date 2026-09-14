import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CreatePlayPlayerDto } from './create-play.dto';

export class UpdatePlayDto {
  @IsOptional()
  @IsIn(['finished', 'abandoned'])
  status?: 'finished' | 'abandoned';

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10080)
  durationMinutes?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be in HH:mm 24-hour format' })
  startTime?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be in HH:mm 24-hour format' })
  endTime?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePlayPlayerDto)
  players!: CreatePlayPlayerDto[];
}
