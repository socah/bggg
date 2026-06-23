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
  @PrimaryGeneratedColumn()
  id: number;

  // NOT NULL by default — matches the SQL constraint in db/schema.sql.
  @Column()
  name: string;

  // @CreateDateColumn sets this automatically on INSERT — you never pass it in.
  // name: 'created_at' matches the snake_case column in the DB; the property
  // stays camelCase to follow TypeScript conventions.
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
