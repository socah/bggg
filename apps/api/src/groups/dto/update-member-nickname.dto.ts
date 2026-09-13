import { IsDefined, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateMemberNicknameDto {
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(100)
  nickname!: string | null;
}
