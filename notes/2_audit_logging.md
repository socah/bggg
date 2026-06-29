# Audit Logging — Pino, audit_log Table, Sensitive Event Capture

**Phase:** 2 — Backend Core
**Topic ID:** `2_audit_logging`
**Date:** 2026-06-29
**SecOps:** Yes

---

## What Is This?

Audit logging is the practice of recording *who did what, to which resource, and when* — permanently and in a tamper-evident way. It has two complementary layers: **application logs** (a stream of structured JSON lines written by the running process, useful for debugging and operations) and an **audit trail** (a database table that records security-relevant events, designed to survive even if the application is compromised or restarted). You need both because they serve different purposes: application logs answer "what happened technically," the audit trail answers "who is accountable."

---

## Why Does It Matter for This Project?

The board game platform has group memberships, role assignments, and game reviews — all of them targets for unauthorized modification. Without an audit trail, if a member is silently promoted to admin or a review is deleted, there is no way to reconstruct what happened, who did it, or when. The audit trail is also the foundation that Phase 5's Loki alerts are built on — you can't alert on "three failed login attempts" if you never recorded them.

---

## The Decision

**Application logger:**
- Chose: **Pino** (via `nestjs-pino`)
- Because: Pino serializes log lines as JSON, which means every field (userId, groupId, action, timestamp) is queryable rather than buried in a human-readable string. It is also the fastest Node.js logger (async, low GC pressure). NestJS's built-in logger writes plain text — unqueryable.
- Alternative: Winston (also popular, also JSON-capable)
- Drawback of alternative: Winston is slower and its async transport story is messier; Pino's design puts I/O on a worker thread by default.

**Audit trail:**
- Chose: a dedicated `audit_log` **PostgreSQL table** (append-only, no UPDATE or DELETE on audit rows)
- Because: the application database is the most durable store you already have. An append-only table means a compromised application process cannot erase its own tracks — it can only add rows, not delete them (enforced by removing DELETE permission from the app's DB user).
- Alternative: write audit events only to the log stream (Pino lines)
- Drawback of alternative: log files can be rotated, truncated, or lost. A database row is transactional — it either commits with the action that triggered it, or rolls back with it.

**Elastic vs Loki (log shipping destination, Phase 5):**
- Chose: Loki (addressed in Phase 5)
- Because: Oracle Cloud Free Tier gives us 1 GB RAM; Elasticsearch needs 2–4 GB minimum. Pino's JSON output is compatible with both — swapping the sink later is possible without changing this code.

---

## Worked Example

This example is NOT the project code. It is a minimal standalone illustration of the two layers.

### Scenario

A tiny Express app where a user deletes a comment. We want to:
1. Log the deletion at the application level (Pino)
2. Record it in the `audit_log` table (PostgreSQL)

### Code / Configuration

```typescript
import pino from 'pino';
import { Pool } from 'pg';

// Pino is configured once and reused everywhere.
// transport.target 'pino-pretty' is for dev readability only —
// in production, remove the transport block and Pino writes raw JSON
// lines to stdout, which your log shipper (Loki/Fluentd) reads.
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty' }
      : undefined,
});

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function deleteComment(actorId: string, commentId: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // The business action.
    await client.query('DELETE FROM comments WHERE id = $1', [commentId]);

    // The audit record — written in the SAME transaction.
    // If the DELETE fails, this INSERT also rolls back: no phantom audit rows.
    // If the INSERT fails, the DELETE also rolls back: no un-audited deletions.
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [actorId, 'comment.deleted', 'comment', commentId],
    );

    await client.query('COMMIT');

    // Pino log: structured fields are queryable by any log aggregator.
    // This is separate from the DB record — it feeds the ops stream.
    logger.info({ actorId, commentId, action: 'comment.deleted' }, 'Comment deleted');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ actorId, commentId, err }, 'Failed to delete comment');
    throw err;
  } finally {
    client.release();
  }
}
```

The `audit_log` table DDL:
```sql
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT NOT NULL,          -- who performed the action (user sub from JWT)
  action      TEXT NOT NULL,          -- namespaced verb: 'comment.deleted', 'group.member_promoted'
  target_type TEXT NOT NULL,          -- what kind of thing was acted on
  target_id   TEXT NOT NULL,          -- which specific thing
  metadata    JSONB,                  -- optional extra context (IP, old value, new value)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NO updated_at, NO soft delete — this table is append-only by design.
);

-- The app DB user gets INSERT only, never UPDATE or DELETE.
-- This is enforced at the PostgreSQL permission level, not just application code.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;
```

### What Is Happening Step by Step

1. **BEGIN** — we open a transaction so the business action and the audit record are atomic.
2. **DELETE FROM comments** — the actual work.
3. **INSERT INTO audit_log** — written inside the same transaction. This is the critical design choice: the audit row is coupled to the action, not written after it.
4. **COMMIT** — both changes land together, or neither does.
5. **logger.info(...)** — a separate Pino log line is emitted *after* commit. This goes to stdout → log shipper → Loki. It is NOT inside the transaction because it is not a database operation. If the process crashes after commit but before this line, the DB record still exists. The two layers are complementary, not redundant.

### What Would Break If You Changed X?

**If you moved the `audit_log` INSERT outside the transaction (after COMMIT):**
The application could DELETE the comment successfully, then crash before reaching the INSERT. The business action happened but left no audit trail. An attacker who knows this race condition could trigger a crash at exactly the right moment (e.g. by sending a second request that causes an exception) to perform an un-audited deletion. This is why the INSERT must be inside BEGIN/COMMIT.

---

## Now Apply It

In the board game platform, audit logging will touch:

- [apps/api/src/main.ts](apps/api/src/main.ts) — replace `NestFactory.create()` with `NestFactory.create(AppModule, { bufferLogs: true })` and configure the Pino logger as the app logger
- `apps/api/src/audit/audit-log.entity.ts` — TypeORM entity for the `audit_log` table
- `apps/api/src/audit/audit.service.ts` — a shared service with a single `log(event)` method, injectable into any other service
- `apps/api/src/auth/auth.guard.ts` — the existing guard will call `AuditService.log()` on auth failures
- `apps/api/src/groups/groups.service.ts` — membership changes (add member, change role, remove member) are the highest-value events to capture

The sensitive events we will capture in this project:
- Auth guard rejection (failed JWT, expired token)
- Group created / deleted
- Group member added / role changed / removed
- Review created / deleted

---

## SecOps Notes

**Security property:** Non-repudiation and forensic trail.

**Attacks it mitigates:**
- **Insider threat / privilege escalation:** If a group member promotes themselves to admin via a bug, the `audit_log` records the action, the actor's `sub` claim, and the timestamp. Without it, the promotion is invisible.
- **Breach scope assessment:** When an incident occurs, "what did the attacker access or change?" is answered by querying `audit_log` by `actor_id` and time range — not by trying to diff database snapshots.
- **Covering tracks:** Because the app DB user has `INSERT` only on `audit_log`, a compromised application process cannot delete its own footprints. An attacker would need direct DB credentials (a separate, harder-to-obtain secret) to erase rows.

**What goes wrong if skipped:**
- Post-incident, you cannot determine blast radius. "Were any groups affected?" becomes unanswerable.
- Compliance: GDPR Article 32 requires "appropriate technical measures" for personal data — an audit trail is the standard evidence that access to personal data is monitored.
- Phase 5 Loki alerts (`5_loki`) depend on structured log fields like `action` and `actorId` — those fields don't exist if we never emit structured logs here.

---

## Checkpoint Questions

1. Why is the `audit_log` INSERT placed inside the same database transaction as the business action, rather than after it?
2. What is the difference between the Pino log line and the `audit_log` table row — why do we need both?
3. If the app DB user has `INSERT` only on `audit_log`, what does that protect against? What does it *not* protect against?
4. What does `bufferLogs: true` in `NestFactory.create()` do, and why is it important when Pino is the logger?
5. Why does removing the `transport` block (pino-pretty) in production matter for Phase 5 (Loki)?

---

## Summary

Built: `AuditLog` TypeORM entity (append-only, `actor_id` stored as raw JWT `sub` string), `AuditService` with a single `log()` method that writes to the DB and emits a Pino log line, `AuditModule` that exports the service for injection elsewhere. Wired `AuditService` into `GroupsService` for `group.created` and `group.deleted` events.

Demonstrated understanding of: why `actor_id` must not be a foreign key (GDPR erasure + cascade risk), why the audit INSERT in the fully atomic pattern must live inside the caller's transaction, why `AuditService.log()` catches and does not re-throw errors (audit failures must not degrade the primary HTTP response), and which log field (`msg: 'audit_write_failed'`) to query in Loki for alert rules.

To revisit: the fully atomic pattern (audit INSERT inside the same transaction as the business action) is not yet implemented in `GroupsService` — the current implementation does a separate auto-commit insert. Worth revisiting when the invite system (Phase 3) adds higher-stakes writes where both-or-nothing matters more.
