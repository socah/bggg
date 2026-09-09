import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateSessionPlaceDto {
  @IsOptional()
  @IsUUID()
  placeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
