import { IsDefined, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdatePlayNoteDto {
  @IsDefined()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
