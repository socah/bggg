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
  Matches,
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
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be in HH:mm 24-hour format' })
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be in HH:mm 24-hour format' })
  endTime?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePlayPlayerDto)
  players!: CreatePlayPlayerDto[];
}
