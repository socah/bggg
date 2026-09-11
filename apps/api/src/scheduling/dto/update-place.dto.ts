import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdatePlaceDto {
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(100)
  name!: string;
}
