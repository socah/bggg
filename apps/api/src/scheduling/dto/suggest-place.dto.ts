import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class SuggestPlaceDto {
  @IsOptional()
  @IsUUID()
  placeId?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(100)
  name?: string;
}
