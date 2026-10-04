import {
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  NotFound,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// How long a presigned upload URL stays valid. Short on purpose — a leaked
// URL (browser history, a shared screenshot, a proxy log) is only useful for
// this narrow window, not indefinitely. See notes/3_r2_uploads.md.
const PRESIGN_EXPIRY_SECONDS = 300;

// Read access gets its own, longer window — unlike a one-shot upload, a
// user might sit on a session's photo gallery for a while, and re-signing a
// fresh GET URL for every single render would mean an extra R2 round trip
// (well, a local HMAC computation, but still a wasted one) each time. 15
// minutes is still short enough that a leaked URL (shared screenshot,
// browser history) closes itself out well before "forever" the way a
// public bucket URL would.
const GET_PRESIGN_EXPIRY_SECONDS = 900;

// Only image types the app actually wants to serve back to users. Baking
// this into the signed request means R2 rejects an upload whose real
// Content-Type header doesn't match one of these — a client can't smuggle
// an HTML/SVG payload through by lying about the type when it PUTs the file.
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Single source of truth for the key layout ("play-photos/<userId>/<uuid>").
// Both buildObjectKey and keyBelongsToUser derive from this constant so the
// format can never drift out of sync between "how a key is created" and
// "how a key's owner is checked" — those used to be two separate hardcoded
// string literals in two different files.
const PLAY_PHOTOS_PREFIX = 'play-photos';

// Configurable via env, not a compile-time constant, so the cap can be
// raised or lowered without a code change or redeploy of application logic —
// matches this project's "raw process.env, no ConfigService" convention
// (see auth.guard.ts). Defaults to 10 MiB if unset.
export const MAX_UPLOAD_BYTES = parseInt(
  process.env.MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024),
  10,
);

// R2's free tier is 10 GiB of storage (per design.md). Configurable so a
// paid tier or a different bucket's actual limit can be reflected without a
// code change. This is a soft, approximate guard, not a hard guarantee —
// see the caveat on hasCapacityFor below.
const MAX_STORAGE_BYTES = parseInt(
  process.env.R2_MAX_STORAGE_BYTES ?? String(10 * 1024 * 1024 * 1024),
  10,
);

@Injectable()
export class R2Service {
  // Built once when the module is instantiated, not per-request — matches
  // the JWKS-resolver pattern in auth.guard.ts. One client is reused for the
  // life of the process; the SDK handles connection pooling internally.
  private readonly client = new S3Client({
    // R2 ignores this value but the SDK requires the field to be set.
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    // The SDK otherwise adds a CRC32 for the empty presign-time body. The
    // browser later sends the real image, so R2 rejects that mismatched
    // checksum and its CORS-less error surfaces only as a network failure.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  private readonly bucket = process.env.R2_BUCKET!;

  // Generates a presigned PUT URL scoped to exactly one object key, one
  // content type and a short expiry. The caller
  // (UploadsService) decides WHO is allowed to call this and WHAT key to
  // use — this method only knows how to validate-and-sign.
  //
  // Content-Length is deliberately not signed. Browser JavaScript cannot
  // control that forbidden header, so signing it makes direct uploads
  // browser-dependent. confirm() enforces the limit against R2's actual
  // stored object size and deletes an oversized object.
  async createPresignedUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ url: string; expiresIn: number }> {
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new UnsupportedMediaTypeException(
        `${contentType} is not an allowed image type`,
      );
    }

    if (contentLength > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `File size ${contentLength} bytes exceeds the ${MAX_UPLOAD_BYTES} byte limit`,
      );
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    // getSignedUrl never contacts R2 — it computes an HMAC signature locally
    // from the command details, the credentials, and an expiry timestamp,
    // then encodes all of it into the URL's query string. R2 re-derives the
    // same signature on receipt to verify the request wasn't tampered with.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
    });

    return { url, expiresIn: PRESIGN_EXPIRY_SECONDS };
  }

  async uploadObject(key: string, contentType: string, body: Buffer): Promise<void> {
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new UnsupportedMediaTypeException(
        `${contentType} is not an allowed image type`,
      );
    }
    if (!this.isUploadSizeAllowed(body.length)) {
      throw new PayloadTooLargeException('Uploaded file exceeds the file size limit');
    }

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      Body: body,
    }));
  }

  // The object key is generated here, server-side, from the requesting
  // user's id plus a random UUID — never from client input. This is what
  // stops one user from requesting a key that overwrites another user's
  // photo (e.g. by guessing or submitting someone else's path).
  buildObjectKey(userId: string): string {
    return `${PLAY_PHOTOS_PREFIX}/${userId}/${randomUUID()}`;
  }

  // Checks whether a key follows the layout buildObjectKey would have
  // produced for this specific user. Used by UploadsService.confirm as a
  // defense-in-depth check against a client submitting a key it wasn't
  // actually issued (someone else's key, or a fabricated one) — see
  // notes/3_r2_uploads.md.
  keyBelongsToUser(key: string, userId: string): boolean {
    return key.startsWith(`${PLAY_PHOTOS_PREFIX}/${userId}/`);
  }

  // Confirms the object actually exists in R2 before the caller trusts it
  // enough to write a database row, and returns its real size. HeadObject
  // asks R2 for an object's metadata without downloading its body; R2
  // responds with metadata if the key exists, or throws NotFound if it
  // doesn't — e.g. because the client called /uploads/confirm without ever
  // completing the PUT, or the PUT failed partway through. Returning the
  // size here (rather than trusting the client's presign-time contentLength)
  // is what lets PlayPhoto.sizeBytes reflect what R2 actually stored.
  async headObject(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch (err) {
      if (err instanceof NotFound) return null;
      throw err;
    }
  }

  // Approximates whether adding `incomingBytes` more storage would push the
  // bucket over MAX_STORAGE_BYTES, given the caller's own running total.
  //
  // Caveat: this is a soft check, not an atomic reservation. Two presign
  // requests issued milliseconds apart could both pass this check before
  // either one's photo is confirmed and counted — for a small private
  // gaming group with occasional uploads that race is negligible, but this
  // is not the pattern to copy for a system with real concurrent load.
  hasCapacityFor(currentTotalBytes: number, incomingBytes: number): boolean {
    return currentTotalBytes + incomingBytes <= MAX_STORAGE_BYTES;
  }

  isUploadSizeAllowed(sizeBytes: number): boolean {
    return sizeBytes <= MAX_UPLOAD_BYTES;
  }

  // Generates a presigned, time-limited GET URL for one exact object key —
  // the read-side counterpart of createPresignedUploadUrl. This bucket is
  // NOT public: play session photos are only meant to be visible to
  // members of the group they belong to, and a bare public bucket/custom
  // domain URL has no concept of "member of this group" at all — anyone
  // who ever obtained the URL (a shared link, browser history, a referrer
  // leak) could view it forever, membership notwithstanding. Callers of
  // this method are responsible for having already checked that the
  // requesting user is actually allowed to see this specific photo (same
  // membership check GroupsService.findOne already does elsewhere) —
  // signing an already-authorized key, not an access-control mechanism in
  // itself. See notes/3_r2_uploads.md's Update section for the full
  // reasoning behind this move away from a public bucket.
  async createPresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, {
      expiresIn: GET_PRESIGN_EXPIRY_SECONDS,
    });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
