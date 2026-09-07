import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertReviewDto {
  @IsInt()
  @Min(1)
  @Max(10)
  rating!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  complexityScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  depthScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;
}
