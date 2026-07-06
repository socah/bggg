import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// How long a presigned upload URL stays valid. Short on purpose — a leaked
// URL (browser history, a shared screenshot, a proxy log) is only useful for
// this narrow window, not indefinitely. See notes/3_r2_uploads.md.
const PRESIGN_EXPIRY_SECONDS = 300;

// Only image types the app actually wants to serve back to users. Baking
// this into the signed request means R2 rejects an upload whose real
// Content-Type header doesn't match one of these — a client can't smuggle
// an HTML/SVG payload through by lying about the type when it PUTs the file.
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class UnsupportedContentTypeError extends Error {}

@Injectable()
export class R2Service {
  // Built once when the module is instantiated, not per-request — matches
  // the JWKS-resolver pattern in auth.guard.ts. One client is reused for the
  // life of the process; the SDK handles connection pooling internally.
  private readonly client = new S3Client({
    // R2 ignores this value but the SDK requires the field to be set.
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  private readonly bucket = process.env.R2_BUCKET!;

  // Generates a presigned PUT URL scoped to exactly one object key, one
  // content type, and a short expiry. The caller (UploadsService) decides
  // WHO is allowed to call this and WHAT key to use — this method only
  // knows how to sign, not how to authorize.
  async createPresignedUploadUrl(
    key: string,
    contentType: string,
  ): Promise<{ url: string; expiresIn: number }> {
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new UnsupportedContentTypeError(
        `${contentType} is not an allowed image type`,
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

  // The object key is generated here, server-side, from the requesting
  // user's id plus a random UUID — never from client input. This is what
  // stops one user from requesting a key that overwrites another user's
  // photo (e.g. by guessing or submitting someone else's path).
  buildObjectKey(userId: string): string {
    return `play-photos/${userId}/${randomUUID()}`;
  }

  // Builds the public-facing URL for a confirmed upload, from the public
  // bucket domain plus the object key. Kept separate from the key itself so
  // play_photos.key remains the source of truth if the public domain ever
  // changes (e.g. moving from R2's default domain to a custom one).
  buildPublicUrl(key: string): string {
    return `${process.env.R2_PUBLIC_URL_BASE}/${key}`;
  }
}
