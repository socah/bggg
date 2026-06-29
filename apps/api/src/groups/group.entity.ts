import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('groups') maps this class to the 'groups' table.
// We pass the name explicitly because TypeORM defaults to the lowercase class
// name ('group'), but our table is 'groups' — and GROUP is a reserved word
// in SQL, so being explicit here avoids a hard-to-debug runtime error.
@Entity('groups')
export class Group {
  // 'uuid' instructs PostgreSQL to call gen_random_uuid() on INSERT.
  // The resulting value (e.g. "a3f7…") is not guessable, unlike 1, 2, 3.
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // NOT NULL by default — matches the SQL constraint in db/schema.sql.
  @Column()
  name!: string;

  // Stores the JWT `sub` claim of the user who created this group.
  // This is the anchor for all ownership checks — every mutating operation
  // compares the incoming user's sub against this value.
  @Column({ name: 'owner_id' })
  ownerId!: string;

  // @CreateDateColumn sets this automatically on INSERT — you never pass it in.
  // name: 'created_at' matches the snake_case column in the DB; the property
  // stays camelCase to follow TypeScript conventions.
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
