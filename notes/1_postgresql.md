# PostgreSQL Basics — Schema Design, Joins, Foreign Keys, Constraints

**Phase:** 1 — Foundation
**Topic ID:** 1_postgresql
**Date:** 2026-06-23
**SecOps:** No

---

## What Is This?

PostgreSQL is a relational database: data lives in **tables** (rows and
columns), and tables can relate to each other through **foreign keys**. You
query and manipulate data with SQL — a declarative language where you describe
*what* you want, not *how* to find it. PostgreSQL enforces **constraints** —
rules baked into the schema that prevent invalid data from ever being written,
regardless of what the application layer does.

---

## Why Does It Matter for This Project?

Every meaningful entity in the platform — groups, members, games, reviews,
play sessions, invites — lives in PostgreSQL. TypeORM (Phase 2) generates and
manages the schema from your decorated TypeScript classes, but the SQL it
produces is exactly what this note covers. If you don't know what a foreign
key constraint or a join is, you won't be able to read a TypeORM migration,
debug a query, or reason about why a delete fails with a constraint violation.

---

## The Decision

Chose: PostgreSQL over other databases (SQLite, MongoDB, MySQL)
Because: strict schema enforcement, native support for foreign keys and
  transactions, and first-class TypeORM support with migrations.
Alternative: MongoDB (document store — schemaless)
Drawback of alternative: no foreign key constraints, no joins — the
  application has to enforce data integrity, which is error-prone. Fine for
  unstructured data; wrong for a system with well-defined relationships like
  group membership and game ownership.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A film club: members can join clubs, and clubs have screening sessions. We
need to store members, clubs, memberships, and sessions — and be able to
answer questions like "which sessions has this member attended?"

### Code / Configuration

```sql
-- ── TABLES ────────────────────────────────────────────────────────────────

-- A table is a named collection of rows, each with a fixed set of typed columns.
-- SERIAL = auto-incrementing integer. Postgres assigns the next value on each INSERT.
-- PRIMARY KEY = uniquely identifies each row. Implicitly NOT NULL and UNIQUE.
CREATE TABLE member (
  id     SERIAL PRIMARY KEY,
  name   TEXT   NOT NULL,
  email  TEXT   NOT NULL UNIQUE  -- UNIQUE: no two members can share an email
);

CREATE TABLE club (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- ── FOREIGN KEY ───────────────────────────────────────────────────────────
-- A foreign key column stores the id of a row in another table.
-- REFERENCES enforces referential integrity: you cannot insert a member_id
-- that does not exist in the member table.
-- ON DELETE CASCADE: if a club is deleted, all its memberships are deleted too.
-- Without CASCADE, deleting a club that has memberships would error.
CREATE TABLE membership (
  id        SERIAL PRIMARY KEY,
  member_id INT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  club_id   INT NOT NULL REFERENCES club(id)   ON DELETE CASCADE,
  joined_at DATE NOT NULL DEFAULT CURRENT_DATE,

  -- A composite UNIQUE constraint: one member can only join a club once.
  -- Without this, the same member_id + club_id pair could be inserted many times.
  UNIQUE (member_id, club_id)
);

CREATE TABLE screening (
  id       SERIAL PRIMARY KEY,
  club_id  INT  NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  held_on  DATE NOT NULL
);

-- ── SEED DATA ─────────────────────────────────────────────────────────────
INSERT INTO member (name, email) VALUES
  ('Alice', 'alice@example.com'),
  ('Bob',   'bob@example.com');

INSERT INTO club (name) VALUES ('Monday Night Cinema');

-- member 1 (Alice) joins club 1
INSERT INTO membership (member_id, club_id) VALUES (1, 1);

INSERT INTO screening (club_id, title, held_on) VALUES
  (1, 'Parasite',  '2026-05-10'),
  (1, 'Dune',      '2026-05-17');

-- ── JOINS ─────────────────────────────────────────────────────────────────
-- A JOIN combines rows from two tables where a condition is true.
-- INNER JOIN: only returns rows where the condition matches on BOTH sides.
-- Here: "give me all screenings, along with the club name for each one"
SELECT
  s.title,
  s.held_on,
  c.name AS club_name
FROM screening s
INNER JOIN club c ON s.club_id = c.id;

-- Result:
-- title      | held_on    | club_name
-- -----------+------------+---------------------
-- Parasite   | 2026-05-10 | Monday Night Cinema
-- Dune       | 2026-05-17 | Monday Night Cinema


-- A more complex join: "which members belong to which clubs?"
-- We need to go through the membership join table.
SELECT
  m.name  AS member_name,
  c.name  AS club_name,
  ms.joined_at
FROM membership ms
INNER JOIN member m ON ms.member_id = m.id
INNER JOIN club   c ON ms.club_id   = c.id;

-- Result:
-- member_name | club_name           | joined_at
-- ------------+---------------------+------------
-- Alice       | Monday Night Cinema | 2026-06-23


-- LEFT JOIN: returns ALL rows from the left table, even if there is no match
-- on the right. Use this to find members who have NOT joined any club.
SELECT
  m.name,
  ms.club_id  -- NULL if the member has no memberships
FROM member m
LEFT JOIN membership ms ON ms.member_id = m.id;

-- Result:
-- name  | club_id
-- ------+---------
-- Alice | 1
-- Bob   | NULL    ← Bob has no memberships; LEFT JOIN still returns him
```

### What Is Happening Step by Step

1. **`SERIAL PRIMARY KEY`** — Postgres auto-assigns `id = 1, 2, 3, …` on each
   insert. `PRIMARY KEY` adds an implicit index so lookups by `id` are fast,
   and prevents two rows sharing an id.

2. **`NOT NULL`** — a constraint baked into the column definition. Any INSERT
   that omits this column (or passes NULL) is rejected by the database, not
   the application. This enforcement happens even if you connect with a raw
   SQL client, bypassing all your NestJS validation.

3. **`UNIQUE`** — like NOT NULL, enforced at the database level. The composite
   `UNIQUE (member_id, club_id)` on `membership` is a *table constraint* (as
   opposed to a column constraint) because it spans two columns.

4. **`REFERENCES member(id)`** — the foreign key declaration. Postgres tracks
   that `membership.member_id` must always point to a real row in `member`.
   Inserting `member_id = 999` when no member with id 999 exists is an error.

5. **`ON DELETE CASCADE`** — defines what happens to child rows when the parent
   is deleted. CASCADE: delete the children too. The alternative is
   RESTRICT (default): error if children exist. Choose based on what makes
   sense for the data — cascading deletes can surprise you.

6. **`INNER JOIN`** — returns only rows where *both* sides of the condition
   have a match. If a screening's `club_id` pointed to a non-existent club
   (which the foreign key prevents, but hypothetically), that row would be
   silently dropped from the INNER JOIN result.

7. **`LEFT JOIN`** — returns every row from the left table. Columns from the
   right table are NULL when there is no match. Essential for "find things
   with no related record" queries.

### What Would Break If You Changed X?

Remove `UNIQUE (member_id, club_id)` from `membership`:

```sql
-- Without the constraint, this inserts successfully every time:
INSERT INTO membership (member_id, club_id) VALUES (1, 1);
INSERT INTO membership (member_id, club_id) VALUES (1, 1);
INSERT INTO membership (member_id, club_id) VALUES (1, 1);
```

Alice now appears to be a member of the same club three times. Every query
that counts memberships, lists members, or computes anything per-membership
would return duplicated rows. The application layer might check for duplicates
before inserting, but if a bug, race condition, or direct SQL access bypasses
that check, the database accepts the garbage. The constraint is the last line
of defence.

---

## Now Apply It

The board game platform will have tables roughly like these:

- `users` — id, keycloak_sub (the unique ID from the JWT), display_name, avatar_url
- `groups` — id, name, created_at
- `group_members` — group_id + user_id (join table, same pattern as `membership` above)
- `games` — id, bgg_id, name, thumbnail_url (populated from BGG XML API)
- `group_games` — group_id + game_id (which games a group owns)
- `reviews` — id, user_id, game_id, group_id, rating, body
- `play_sessions` — id, group_id, proposed_at, confirmed_at
- `invites` — id, group_id, token, expires_at, used_at
- `audit_log` — id, user_id, action, target_type, target_id, created_at

These don't exist yet — TypeORM will generate the `CREATE TABLE` statements
from decorated classes in Phase 2. When you see `@ManyToMany()` or
`@OneToMany()` in a TypeORM entity, it is describing exactly the foreign key
and join-table pattern from this note.

Files to look at after Phase 2 generates them:
- `apps/api/src/groups/group.entity.ts` — look for `@ManyToMany(() => User)`
- `apps/api/src/games/game.entity.ts` — look for `@ManyToMany(() => Group)`
- Migration files in `apps/api/src/migrations/` — raw SQL TypeORM generates

---

## Checkpoint Questions

1. What is the difference between an INNER JOIN and a LEFT JOIN? Give an
   example of when you would use each.

2. If you delete a club row and `membership.club_id` has `ON DELETE CASCADE`,
   what happens to the related membership rows? What would happen instead if
   it were `ON DELETE RESTRICT`?

3. The `membership` table has `UNIQUE (member_id, club_id)`. Why is this a
   table constraint rather than a column constraint, and what does it prevent?

4. TypeORM will generate a `CREATE TABLE` statement from a decorated
   TypeScript class. Based on this note, what SQL does a `@ManyToMany()`
   relationship likely produce?

5. Why is enforcing constraints at the database level better than only
   enforcing them in the application layer?

---

## Summary

Built: `db/schema.sql` — the full reference data model covering users, groups, group_members, games, group_games, reviews, play_sessions, invites, and audit_log, with inline comments on every design decision.
Demonstrated understanding of: composite unique constraints and why context columns (group_id on reviews) change their meaning; the distinction between ON DELETE CASCADE and ON DELETE SET NULL, and why append-only / historical tables must use SET NULL to preserve records after referenced entities are deleted.
To revisit: none — both checkpoint answers were precise and correctly identified the underlying principle.
