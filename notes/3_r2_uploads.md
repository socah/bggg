# Cloudflare R2 — S3 SDK, Presigned URLs, Direct-to-R2 Upload

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** `3_r2_uploads`
**Date:** 2026-07-06
**SecOps:** Yes

---

## What Is This?

Cloudflare R2 is object storage (like a giant folder of files in the cloud) that
speaks the same API as Amazon S3 — so any tool built for S3 works against R2
with just a different endpoint URL. A **presigned URL** is a temporary,
cryptographically-signed link that grants permission to perform *one specific
operation* (e.g. "PUT a file at this exact path") for a short window of time
(e.g. 5 minutes), without the requester ever having your storage credentials.
NestJS generates that signed URL using credentials it holds privately, hands
it to the browser, and the browser uploads the file **directly** to R2 —
NestJS never sees the file's bytes.

---

## Why Does It Matter for This Project?

Play session photos need somewhere to live, and `design.md` already commits
to R2 for that (10 GB free storage, zero egress fees — real budget constraints
for a hobby project). The naive approach — the browser sends the photo to
NestJS, NestJS forwards it to R2 — means every photo's bytes flow through the
API process twice, tying up memory and CPU on a small VM for no benefit.
Presigned URLs let the API stay a thin control plane: it decides *whether* an
upload is allowed and *where* it's allowed to land, but the actual multi-
megabyte transfer happens directly between the client and R2.

---

## The Decision

Chose: Presigned URL flow — NestJS exposes a `POST /uploads/presign` endpoint
that returns a short-lived signed PUT URL and an object key; the client
uploads straight to R2 with that URL; the client then calls
`POST /uploads/confirm` so NestJS can record the resulting photo in Postgres.

Because: R2's free tier is capped on both storage *and* request count, and a
personal-project VM has limited RAM. Proxying every upload through NestJS
means holding the whole file in memory (or carefully streaming it) just to
immediately re-upload it — real work and real risk (OOM under a couple of
concurrent uploads) for no security benefit, since the guard already
authenticates the request before any signing happens.

Alternative: Multipart proxy upload through NestJS — client sends
`multipart/form-data` to NestJS (via `multer`), NestJS buffers/streams it,
then forwards it to R2 with `PutObjectCommand`. This is literally what
`design.md`'s flow diagram currently shows.

Drawback of alternative: Every upload's bytes pass through the API process
twice (client→NestJS, NestJS→R2). It also makes the API's memory usage scale
with concurrent upload size — something a thin control-plane endpoint
shouldn't have to worry about. `design.md` will be updated to reflect the
presigned-URL flow instead.

---

## Worked Example

This is NOT the board game platform code. It's a minimal Express-style example
isolating just the presigning concept, using a fake in-memory "S3" client so
you can see the shape of the interaction without needing real R2 credentials.

### Scenario

A tiny app lets a logged-in user upload a profile picture. The server never
touches the image bytes — it only decides *if* the user may upload, generates
a signed URL for exactly one object key, and returns it.

### Code / Configuration

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// One client, built once at startup — reused across requests. It holds the
// R2 *account-level* credentials; these never leave the server process.
const s3 = new S3Client({
  region: 'auto', // R2 ignores region but the SDK requires the field
  endpoint: process.env.R2_ENDPOINT, // e.g. https://<account_id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Given an authenticated user id, produce a one-time-use upload URL.
// The object key is generated SERVER-SIDE — the client never chooses where
// its file lands. This is the crux of the security model: signing constrains
// both WHAT can be done (PUT) and WHERE (this exact key), for HOW LONG.
async function createUploadUrl(userId: string, contentType: string) {
  const key = `avatars/${userId}/${crypto.randomUUID()}`;

  const command = new PutObjectCommand({
    Bucket: 'my-app-bucket',
    Key: key,
    ContentType: contentType, // baked into the signature — client can't swap it
  });

  // getSignedUrl doesn't call R2 at all — it computes an HMAC signature over
  // the request locally, using the secret key, and appends it as query
  // parameters. R2 later re-derives that signature from the same secret to
  // verify the request wasn't tampered with and hasn't expired.
  const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes

  return { url, key };
}
```

Client-side (browser), after receiving `{ url, key }` from the server:

```typescript
// This PUT goes DIRECTLY to R2 — not through our own server at all.
await fetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': contentType }, // must match what was signed
  body: file, // a File object from an <input type="file">
});

// Now tell our own server the upload finished, so it can persist `key`
// in the database. R2 has no webhook for "upload completed" in this setup,
// so the client reporting back is what triggers the DB write.
await fetch('/api/uploads/confirm', {
  method: 'POST',
  body: JSON.stringify({ key }),
});
```

### What Is Happening Step by Step

1. **Client asks the server for permission**, not for the file location. The
   server is the only party that decides the object key — this prevents a
   malicious client from requesting a key like `avatars/some-other-user-id/x`
   and overwriting someone else's file.
2. **The server builds a `PutObjectCommand`** describing exactly one allowed
   operation: PUT, to this bucket, at this key, with this content type. It
   never sends this command to R2 — `PutObjectCommand` here is just a
   description used for signing, not a request being made yet.
3. **`getSignedUrl` computes a signature locally.** No network call happens.
   The signature is a hash of the request details plus the secret key plus an
   expiry timestamp, encoded into the URL's query string. Anyone with the URL
   can perform *that exact request* until it expires — but cannot use it to
   PUT to a different key, or GET anything, because the signature wouldn't
   match a different operation.
4. **The client uploads directly to R2** using that URL. R2 recomputes the
   expected signature from the request it actually received and the *same*
   secret key (which R2 has server-side, not the client) and compares. A
   mismatched Content-Type, key, or an expired timestamp all cause R2 to
   reject the request with 403 — before touching any storage.
5. **The client reports completion back to the server**, which is the only
   party allowed to write to Postgres. The server trusts its own key
   generation (step 2) — it doesn't need to re-verify the file exists in R2 for
   this simple flow, though a stricter version could call `HeadObject` to
   confirm before writing the DB row.

### What Would Break If You Changed X?

If `expiresIn` were set to something huge (e.g. a week) instead of 300
seconds, a leaked URL (browser history, a proxy log, a shared screenshot)
would stay exploitable for that entire week — anyone with it could upload
arbitrary content to that exact key during the whole window. Short expiry
turns a leaked URL into a narrow, self-closing window instead of a standing
vulnerability.

---

## Now Apply It

In the real codebase this becomes an `uploads` module following the same
shape as `groups` (`groups.module.ts` / `.controller.ts` / `.service.ts` in
[group.entity.ts](../apps/api/src/groups/group.entity.ts)): an `R2Service`
wrapping the S3 client (config read from `process.env.R2_*`, matching how
`KEYCLOAK_URL` is read as a raw env var in
[auth.guard.ts](../apps/api/src/auth/auth.guard.ts) — no `ConfigService` in
this project), an `UploadsController` with `POST /uploads/presign` and
`POST /uploads/confirm`, both behind the existing `AuthGuard`, and a new
`PlayPhoto` entity to persist the confirmed key/URL.

One deliberate gap: `design.md`'s `play_photos` table has a `session_id`
foreign key into `play_sessions` — but `play_sessions` doesn't exist yet
(that's topic `3_scheduling`, still ahead of us). So `PlayPhoto.sessionId`
will be built as a plain UUID column with no FK constraint for now, and wired
up to a real foreign key once `3_scheduling` lands. This will be called out
again when we get there.

Files to look at after this note:
- `apps/api/src/groups/groups.module.ts` — the module-wiring pattern
  (`TypeOrmModule.forFeature`, controller/provider/export) that `uploads`
  will follow.
- `apps/api/src/auth/auth.guard.ts` — how the guard reads `request.user.sub`;
  the upload confirm endpoint uses this the same way `groups` does for
  `ownerId`, to record `uploadedBy` on `PlayPhoto`.

---

## SecOps Notes

**Security property upheld:** least-privilege, time-boxed authorization. The
server never hands out its long-lived R2 credentials — it hands out a
narrowly-scoped, short-lived capability (this key, this operation, this
content-type, five minutes) computed from those credentials.

**What this mitigates:**
- A leaked signed URL only threatens *one object* for *a few minutes*, not
  the whole bucket indefinitely (contrast with leaking the actual
  `R2_SECRET_ACCESS_KEY`, which would be a full-bucket, unlimited-time
  compromise).
- Signing the object key server-side (never accepting a client-supplied path)
  prevents path-traversal-style abuse where a user tries to overwrite another
  user's photo by guessing or submitting their key.
- Signing `ContentType` prevents a client from uploading, say, an HTML file
  with script content to a URL the app later serves and links to as an
  "image" — a stored-XSS vector if the content type at serve-time were
  attacker-controlled.

**What would go wrong if skipped:** If the server just returned a bucket name
and let the client pick the key and content type freely, any authenticated
user could overwrite any other user's photo, or upload disguised executable
content that gets served back with a browser-trusted URL. If credentials were
sent to the client directly instead of presigning server-side, every user's
browser session would hold full read/write access to the *entire* bucket.

**Checklist applied:**
- [ ] Object key generated server-side from `userId` + random UUID, never
      accepted from the client
- [ ] `ContentType` baked into the signature, restricted to an image
      allowlist (`image/jpeg`, `image/png`, `image/webp`) in the real
      controller
- [ ] `expiresIn` kept short (minutes, not hours)
- [ ] R2 credentials only ever read via `process.env` on the server; never
      sent to the client, never logged
- [ ] `play_photos.id` will be a UUID primary key (public-facing resource) —
      consistent with `secops.md`'s "public-facing IDs are UUIDs" rule

---

## Checkpoint Questions

1. Why does the object key get generated on the server instead of being sent
   by the client in the presign request?
2. If someone captured a presigned upload URL from a network log five minutes
   after it was issued, could they still use it? Why or why not?
3. What is actually being verified when R2 receives the signed PUT request —
   what does R2 recompute, and what does it compare it against?
4. This project's `AuthGuard` already reads `request.user.sub` for ownership
   checks elsewhere (e.g. `Group.ownerId`). How does `/uploads/presign` reuse
   that same pattern for `PlayPhoto.uploadedBy`?
5. Why was the "proxy through NestJS" approach from `design.md` rejected in
   favor of presigned URLs, given this is a small/personal deployment?

---

## Summary

[To be filled in by Claude Code after checkpoint.]
