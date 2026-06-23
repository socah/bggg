# TypeORM Entities — Decorators, Column Types, Relations, Migrations

**Phase:** 2 — Backend Core
**Topic ID:** 2_typeorm_entities
**Date:** 2026-06-24
**SecOps:** No

---

## What Is This?

TypeORM is the library that bridges TypeScript classes and PostgreSQL tables.
Instead of writing raw SQL to define your schema, you write a TypeScript class
decorated with `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()`, and
relation decorators like `@ManyToOne()`. TypeORM reads those decorators at
runtime to know the shape of each table and can generate **migration files** —
plain SQL scripts that apply schema changes in a controlled, versioned way.

---

## Why Does It Matter for This Project?

Right now `GroupsService` uses a plain TypeScript interface and an in-memory
array. That data disappears every time the server restarts. Replacing it with
a TypeORM entity backed by PostgreSQL means groups persist, can be queried with
joins and filters, and are defined in one place (the entity class) rather than
spread across a SQL file and a TypeScript interface. The `db/schema.sql` file
already shows the target tables — TypeORM entities are the TypeScript mirror of
that schema.

---

## The Decision

Chose: **TypeORM with decorators + migration files**

Because: decorator-based entities keep the database schema co-located with the
TypeScript type that represents it — one class is both the schema definition
and the runtime type. Migrations give us a versioned history of every schema
change, which is essential for safely updating a production database.

Alternative: **Prisma**

Drawback of alternative: Prisma uses a separate `.prisma` schema file (not
TypeScript decorators), which means the schema and the TypeScript types are
defined in different languages and must be kept in sync via a code-generation
step. TypeORM's decorator approach fits more naturally with NestJS's decorator
culture and means less context-switching.

Alternative: **raw SQL migrations (no ORM)**

Drawback of alternative: You gain full SQL control but lose the TypeScript type
safety and the ability to write queries as method calls. For a project where the
goal is to understand the whole system end to end, the ORM layer is worth the
abstraction.

---

## Worked Example

This example is NOT the project code. It is a standalone example: a tiny
`Post` entity for a blogging app, with a relation to an `Author` entity.

### Scenario

We have two tables: `authors` and `posts`. Each post belongs to one author;
one author can have many posts. We want TypeORM to manage the schema and let
us query posts via a repository.

### Code / Configuration

```typescript
// ─── author.entity.ts ────────────────────────────────────────────────────────

import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Post } from './post.entity';

// @Entity() tells TypeORM: "this class maps to a database table".
// By default the table name is the lowercase class name: 'author'.
// Pass a string to override: @Entity('blog_authors') → table 'blog_authors'.
@Entity()
export class Author {
  // @PrimaryGeneratedColumn() → SERIAL PRIMARY KEY in PostgreSQL.
  // TypeORM generates the id value; you never set it manually.
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  // @Column({ nullable: true }) → the column allows NULL.
  // Default is NOT NULL, matching most SQL conventions.
  @Column({ nullable: true })
  bio: string | null;

  // @OneToMany: one author → many posts.
  // The second argument is the "inverse side": a function that returns
  // the property on Post that points back to Author.
  // This side does NOT create a foreign key column — that lives on Post.
  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];
}
```

```typescript
// ─── post.entity.ts ──────────────────────────────────────────────────────────

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Author } from './author.entity';

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  // @Column({ length: 255 }) → VARCHAR(255) in SQL.
  // Omitting length gives TEXT (unlimited), which is usually fine for
  // PostgreSQL but matters if you need consistent lengths for indexing.
  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  // @ManyToOne: many posts → one author.
  // This side OWNS the relation — it creates the foreign key column
  // (author_id by default). TypeORM derives the column name from the
  // property name + 'Id'.
  @ManyToOne(() => Author, (author) => author.posts, {
    // onDelete: 'CASCADE' → if the author is deleted, all their posts are too.
    // Matches the ON DELETE CASCADE in raw SQL.
    onDelete: 'CASCADE',
  })
  // @JoinColumn() is optional on ManyToOne but makes the FK column name explicit.
  // Without it TypeORM picks the name automatically (fine for most cases).
  @JoinColumn({ name: 'author_id' })
  author: Author;

  // @CreateDateColumn() → TIMESTAMPTZ NOT NULL DEFAULT NOW().
  // TypeORM sets this automatically on INSERT; you never pass it in.
  // The equivalent for updates is @UpdateDateColumn().
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

```typescript
// ─── blog.module.ts ──────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Author } from './author.entity';
import { Post } from './post.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  // TypeOrmModule.forFeature([...]) registers the given entities with
  // TypeORM and makes their Repository available for injection in this module.
  // Without this, injecting Repository<Post> would throw at startup.
  imports: [TypeOrmModule.forFeature([Author, Post])],
  controllers: [PostsController],
  providers: [PostsService],
})
export class BlogModule {}
```

```typescript
// ─── posts.service.ts (excerpt) ──────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from './post.entity';

@Injectable()
export class PostsService {
  constructor(
    // @InjectRepository(Post) injects the TypeORM repository for the Post entity.
    // The repository is the object you call .find(), .save(), .delete() on.
    // NestJS knows which repository to inject because TypeOrmModule.forFeature
    // registered it in BlogModule above.
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
  ) {}

  findAll(): Promise<Post[]> {
    // .find() → SELECT * FROM post
    return this.postRepository.find();
  }

  findOne(id: number): Promise<Post | null> {
    // .findOneBy() → SELECT * FROM post WHERE id = $1
    return this.postRepository.findOneBy({ id });
  }

  async create(title: string, body: string, authorId: number): Promise<Post> {
    // .create() builds an entity instance without hitting the database.
    // .save() then INSERT or UPDATEs based on whether an id is already set.
    const post = this.postRepository.create({ title, body, author: { id: authorId } });
    return this.postRepository.save(post);
  }
}
```

### What Is Happening Step by Step

1. **Decorators define the schema** — when TypeORM processes `@Entity()` and
   `@Column()`, it builds an internal metadata registry (a big object in memory)
   that maps each class to a table and each property to a column. No SQL is
   run yet.

2. **`TypeOrmModule.forFeature([Author, Post])`** — tells NestJS to make
   `Repository<Author>` and `Repository<Post>` injectable. Without this, the
   `@InjectRepository(Post)` in the service would throw at startup.

3. **`TypeOrmModule.forRoot(...)` in `AppModule`** — this is where the actual
   PostgreSQL connection is configured (host, port, user, password, database).
   It also receives `entities: [Author, Post]` or `autoLoadEntities: true`
   so TypeORM knows which classes to map.

4. **`@InjectRepository(Post)` in the service constructor** — NestJS resolves
   this to the Repository instance for the `Post` table. You call methods on it
   (`find`, `findOneBy`, `save`, `delete`) and TypeORM translates them to SQL.

5. **Migrations** — when you run `typeorm migration:generate`, TypeORM compares
   the entity metadata (what the decorators say the schema should be) against
   the current database state and generates a SQL migration file containing only
   the `ALTER TABLE` / `CREATE TABLE` statements needed to close the gap.

### What Would Break If You Changed X?

**Remove `TypeOrmModule.forFeature([Post])` from `BlogModule`:**

The service constructor asks for `@InjectRepository(Post)`. NestJS tries to
resolve it, finds no registered `Repository<Post>` in scope, and throws
`Nest can't resolve dependencies of the PostsService (?)` at startup — before
any request is handled. The error message will say the token is
`PostRepository`, which is the internal token TypeORM registers for each entity.

---

## Now Apply It

We will convert the existing `Group` interface in [apps/api/src/groups/groups.service.ts](apps/api/src/groups/groups.service.ts)
into a TypeORM entity, wire it into `GroupsModule`, and replace the in-memory
array with a real `Repository<Group>` backed by PostgreSQL.

The target schema is already in [db/schema.sql](db/schema.sql) — the `groups` table:

```sql
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL       PRIMARY KEY,
  name        TEXT         NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

Files we will create or modify:
- `apps/api/src/groups/group.entity.ts` — the new entity class (mirrors the SQL above)
- [apps/api/src/groups/groups.module.ts](apps/api/src/groups/groups.module.ts) — add `TypeOrmModule.forFeature([Group])`
- [apps/api/src/groups/groups.service.ts](apps/api/src/groups/groups.service.ts) — replace in-memory array with `Repository<Group>`
- [apps/api/src/app.module.ts](apps/api/src/app.module.ts) — add `TypeOrmModule.forRoot(...)` with the DB connection

---

## Checkpoint Questions

1. What is the difference between `@PrimaryGeneratedColumn()` and
   `@Column()` — what SQL does each produce?
2. If you define a `@ManyToOne` relation on `Post` pointing to `Author`,
   which table gets the foreign key column, and how does TypeORM name it by
   default?
3. You forgot to add `Group` to `TypeOrmModule.forFeature([...])` in
   `GroupsModule`. What specific error appears, and when — startup or runtime?
4. What is the difference between `TypeOrmModule.forRoot()` and
   `TypeOrmModule.forFeature()`? Which goes in `AppModule` and which in the
   feature module, and why?
5. What does a migration file actually contain, and why is it preferable to
   setting `synchronize: true` in production?

---

## Rewrite Exercise

`rewrite: true` — after the entity and service are generated, delete
`group.entity.ts` and the repository injection in `groups.service.ts`, then
recreate them from memory.

Focus on: the decorator set for a column that is nullable vs. not nullable,
the `@CreateDateColumn()` shorthand, and the `@InjectRepository()` +
`Repository<T>` pattern in the service constructor. These are the three points
most likely to be fuzzy after a first pass.

---

## Summary

[Filled in after checkpoint is complete.]
