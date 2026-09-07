import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AddListGameDto {
  @IsInt()
  @Min(1)
  bggId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tier?: string;
}
