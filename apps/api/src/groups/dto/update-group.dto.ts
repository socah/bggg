import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class UpdateGroupDto {
  // @IsOptional means the field can be absent entirely — but if it IS sent,
  // the remaining decorators still apply. Sending { "name": "" } still fails.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string; // optional so no ! needed — undefined is a valid value
}
