import { IsUUID } from 'class-validator';

export class UploadPhotoDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  playId!: string;
}
