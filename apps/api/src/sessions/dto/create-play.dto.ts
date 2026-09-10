import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlayPlayerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string;

  @IsOptional()
  @IsUUID()
  guestPlayerId?: string;

  @IsOptional()
  @IsBoolean()
  isWinner?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  score?: string;
}

export class CreatePlayDto {
  @IsInt()
  @Min(1)
  gameId!: number;

  @IsDateString({ strict: true })
  playedDate!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  proposalId?: string;

  @IsOptional()
  @IsIn(['finished', 'abandoned'])
  status?: 'finished' | 'abandoned';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePlayPlayerDto)
  players!: CreatePlayPlayerDto[];
}
