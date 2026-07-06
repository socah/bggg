import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

export class PresignUploadDto {
  // Which play session this photo will belong to. Required up front (not
  // just at confirm time) because R2Service still needs to know nothing
  // about sessions — the object key only encodes the uploader, not the
  // session — so sessionId has to travel through both calls explicitly.
  @IsInt()
  @IsPositive()
  sessionId!: number;

  // Checked again against the allowlist in R2Service.createPresignedUploadUrl.
  // Validated here too so a request with a garbage value 400s immediately,
  // before any signing work happens.
  @IsString()
  @IsNotEmpty()
  contentType!: string;
}
