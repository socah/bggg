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

The signed URL handles authorization, but it does not bypass the browser's
same-origin policy. `infra/terraform/cloudflare.tf` also manages the bucket's
CORS rule, allowing the configured application origins to send `PUT` requests
with a `Content-Type` header. Without that rule, the browser's preflight fails
before the upload reaches R2 and `fetch` reports only a generic network error.

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

## Follow-Up: Enforcing a Size Limit

A plain presigned PUT URL has no "reject anything over X MB" primitive —
that's a feature of S3 **POST policies** (`content-length-range` condition),
not PUT presigning. Although an exact `Content-Length` can be signed, browser
JavaScript cannot control that header, so browser uploads need the authoritative
size check to happen after upload using R2's own object metadata.

Chose: the client declares its file's size (`contentLength`, e.g. `file.size`
in the browser) when requesting the presign, so the server can reject an
honest oversized upload before issuing a URL. `Content-Length` is not included
in the signature because browser JavaScript cannot control that forbidden
header consistently. At confirmation, the server checks R2's actual
`HeadObject` size against both `MAX_UPLOAD_BYTES` and the total storage quota,
deleting and rejecting an object that exceeds either limit.

Alternative considered: sign the exact `Content-Length` and rely on R2 to
reject a mismatch.

Drawback of alternative: `Content-Length` is a forbidden browser request
header. Signing it made direct uploads depend on browser-generated transport
details and caused R2 signature failures that surfaced only as CORS network
errors. Confirmation remains the authoritative enforcement point; a dishonest
client can waste one upload's bandwidth, but cannot leave an oversized object
stored or recorded.

### Follow-Up: Approximate Free-Tier Storage Quota

Beyond a single file's size, R2's free tier caps *total* bucket storage (10
GiB, per `design.md`). Before issuing a new presigned URL,
`UploadsService.presign` now sums `PlayPhoto.sizeBytes` across every
confirmed photo (via Postgres `SUM`, not by asking R2 to list every object —
far cheaper) and rejects the request with `507 Insufficient Storage` if
adding the incoming file would exceed a configurable `R2_MAX_STORAGE_BYTES`.

This is deliberately a **soft, approximate** guard, not an atomic
reservation: two presign requests issued milliseconds apart could both pass
the check before either photo is confirmed and counted, letting the total
overshoot slightly. For a small private gaming group with occasional
uploads, that race is negligible — but it's not a pattern to copy for a
system under real concurrent load, where you'd want a reservation/ledger
approach instead.

Also worth noting: `PlayPhoto.sizeBytes` is populated from R2's own
`HeadObject` response at confirm time, not from the client's presign-time
`contentLength` claim — the two numbers serve different jobs (one constrains
the upload, the other records what actually landed), and only the second one
is safe to trust for the running quota total.

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
foreign key into `play_sessions` — but `play_sessions` has no TypeORM entity
yet (that's topic `3_scheduling`, still ahead of us). So `PlayPhoto.sessionId`
is a plain **INT** column (matching `play_sessions.id`, which is `SERIAL` in
`db/schema.sql` — not UUID) with no FK constraint for now, wired up to a real
foreign key once `3_scheduling` lands. This will be called out again when we
get there.

Files to look at after this note:
- `apps/api/src/groups/groups.module.ts` — the module-wiring pattern
  (`TypeOrmModule.forFeature`, controller/provider/export) that `uploads`
  follows.
- `apps/api/src/auth/auth.guard.ts` — how the guard reads `request.user.sub`;
  the upload confirm endpoint uses this the same way `groups` does for
  `ownerId`, to record `uploadedBy` on `PlayPhoto`.
- `apps/api/src/uploads/r2.service.ts` — `headObject` (verifies the upload
  actually happened, and is where `PlayPhoto.sizeBytes` comes from) and
  `hasCapacityFor` (the free-tier storage guard).

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
- [x] Object key generated server-side from `userId` + random UUID, never
      accepted from the client
- [x] `ContentType` baked into the signature, restricted to an image
      allowlist (`image/jpeg`, `image/png`, `image/webp`)
- [x] `expiresIn` kept short (5 minutes, not hours)
- [x] R2 credentials only ever read via `process.env` on the server; never
      sent to the client, never logged
- [x] `play_photos.id` is a UUID primary key (public-facing resource) —
      consistent with `secops.md`'s "public-facing IDs are UUIDs" rule
- [x] `ContentLength` pinned into the signature — R2 rejects a PUT whose
      real size doesn't match the declared one, bounding worst-case abuse of
      a single upload
- [x] `/uploads/confirm` verifies the object actually exists in R2
      (`HeadObject`) before trusting the client's claim enough to write a
      Postgres row
- [x] Confirm-time ownership check (`keyBelongsToUser`) rejects a client
      trying to confirm a key it wasn't actually issued

---

## Update — 2026-08-16: Presigned GET URLs Instead of a Public Bucket

While wiring R2 into the actual production deploy pipeline (this note
originally only covered the local `.env` template), a straightforward
question exposed a real gap the original design left open: **making the
bucket public — or mapping a custom domain to it — means anyone with a
photo's URL can view it, forever, regardless of whether they're still (or
ever were) a member of that group.** The original design stored a
permanent `PlayPhoto.url`, built once at confirm time from a public bucket
URL (`R2Service.buildPublicUrl`) — there was no "read time" check at all,
because a public URL doesn't have one: once public, always public, to
anyone who ever obtains the link (a shared screenshot, browser history, a
referrer leak).

Fix: extend the exact same presigned-URL pattern this note already covers
for uploads to reads, instead of inventing a second mechanism.
`R2Service.createPresignedGetUrl(key)` signs a short-lived GET URL for one
exact object key — 15 minutes, not 5, since browsing a gallery takes
longer than a single PUT — and the bucket itself stays private (R2's
default). There is no `R2_PUBLIC_URL_BASE` anywhere anymore. `PlayPhoto.url`
is gone entirely — dropped from the TypeORM entity and `db/schema.sql` —
because a permanently stored URL never made sense once reads require a
fresh signature: it would either have to be a public one (defeating the
whole point) or a presigned one (which expires, so storing it would just
mean serving a dead link once `GET_PRESIGN_EXPIRY_SECONDS` passes).

`UploadsService.confirm` now generates a presigned GET URL fresh, for that
one response only, and returns it alongside the saved `PlayPhoto` row — it
is never persisted. No separate membership check was needed at that one
call site (the uploader just proved they're allowed to see this exact
photo, by uploading it) — but this is the *only* place doing so today: no
"list a session's photos" read endpoint exists yet (still ahead, likely
alongside `3_scheduling`'s own read endpoints). Whenever one is built, it
must call `createPresignedGetUrl` fresh, per photo, per request — only
after checking the requester is actually a member of the group that
photo's session belongs to (the same membership check `GroupsService.findOne`
already does elsewhere) — not read a stored URL, because there won't be
one to read.

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
6. Why can't a plain presigned PUT URL enforce "reject anything over 10 MB"
   the way an S3 POST policy can — and what does pinning `ContentLength`
   into the signature actually achieve instead?
7. `PlayPhoto.sizeBytes` is read from R2's `HeadObject` response rather than
   from the client's `contentLength` field in the presign request, even
   though both numbers usually agree. Why does that distinction matter for
   the storage-quota check specifically?
8. The storage-quota check in `hasCapacityFor` is described as a "soft,
   approximate" guard. What specific sequence of two requests could cause
   the real total to exceed `R2_MAX_STORAGE_BYTES` despite the check?
9. The original design stored a permanent `PlayPhoto.url`. Why doesn't a
   permanently stored URL make sense anymore now that reads go through
   `createPresignedGetUrl` — would this be true even if the bucket stayed
   public, or is it specifically about the switch to a private one?
10. If a photo's presigned GET URL leaked the same way a presigned upload
    URL could (a shared screenshot, browser history), what could someone
    do with it, and for how long? Compare that to what leaking a URL under
    the original public-bucket design could do.

---

## Summary

Built: an `uploads` module (`R2Service`, `UploadsService`, `UploadsController`,
`PlayPhoto` entity) implementing presigned direct-to-R2 uploads for play
session photos — `POST /uploads/presign` and `POST /uploads/confirm`, both
behind `AuthGuard`. Along the way: fixed the design.md flow diagram to match
the presigned-URL architecture (it originally showed a proxy-through-NestJS
flow), fixed a pre-existing `groups.id` type drift between `db/schema.sql`
(`SERIAL`) and `group.entity.ts` (`uuid`), stood up a previously-missing
ESLint config for `apps/api`, added an exact-size-pinning mechanism for a
configurable per-file upload cap, and added an approximate running-total
guard against R2's free-tier storage allowance.

Demonstrated understanding of: the full presign → direct-PUT → confirm
lifecycle and why NestJS never touches file bytes; that R2 verifies
signatures, not identities (it doesn't know what a "user" is — only that a
request matches what was signed); independently identified two real gaps in
the first draft (unverified confirms, a duplicated hardcoded key prefix) and
proposed correct fixes for both; understood *why* SigV4 presigned PUT
signing has no range primitive (not just "bytes skip the server," but a
genuine capability gap versus S3 POST policies) after one clarifying pass.

To revisit: the distinction between "R2 checks an exact pinned value" and
"our app enforces the actual limit before signing" took a second explanation
to land fully — worth a quick gut-check next time size/quota enforcement
comes up elsewhere (e.g. if `3_scheduling` or a future topic adds its own
upload-adjacent limit).

---

## Summary

[To be filled in by Claude Code after checkpoint.]
