import { IsInt, IsNotEmpty, IsPositive, IsString, IsUUID } from 'class-validator';

export class PresignUploadDto {
  // Which play session this photo will belong to. Required up front (not
  // just at confirm time) because R2Service still needs to know nothing
  // about sessions — the object key only encodes the uploader, not the
  // session — so sessionId has to travel through both calls explicitly.
  // uuid, matching PlaySession.id (topic 3_scheduling).
  @IsUUID()
  sessionId!: string;

  // Checked again against the allowlist in R2Service.createPresignedUploadUrl.
  // Validated here too so a request with a garbage value 400s immediately,
  // before any signing work happens.
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  // The exact size (in bytes) of the file the client is about to upload —
  // e.g. `file.size` in the browser. Not just an advisory value: this gets
  // pinned into the presigned URL's signature (see R2Service), so the
  // actual PUT must match this exact byte count. Not validated with a fixed
  // decorator max here on purpose — the real cap (MAX_UPLOAD_BYTES) lives
  // in R2Service so it stays configurable via env var without touching this
  // DTO. This decorator only rejects structurally invalid values.
  @IsInt()
  @IsPositive()
  contentLength!: number;
}
