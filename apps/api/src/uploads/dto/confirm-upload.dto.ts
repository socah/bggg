import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class ConfirmUploadDto {
  // The object key returned by a prior /uploads/presign call. UploadsService
  // checks this key actually belongs to the requesting user before trusting
  // it — see the ownership check in uploads.service.ts.
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsInt()
  @IsPositive()
  sessionId!: number;
}
