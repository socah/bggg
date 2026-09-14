import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePlayPlayerDto)
  players!: CreatePlayPlayerDto[];
}
