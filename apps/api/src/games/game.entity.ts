import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('games') maps to the 'games' table.
// Explicit name avoids TypeORM defaulting to 'game' (singular).
@Entity('games')
export class Game {
  @PrimaryGeneratedColumn()
  id!: number;

  // bggId is our foreign key into BGG's catalogue — what we pass to the BGG API.
  // unique: true enforces at the DB level that we never cache the same BGG game twice.
  @Column({ name: 'bgg_id', unique: true })
  bggId!: number;

  @Column()
  name!: string;

  // nullable: true — description can be absent for some BGG entries.
  @Column({ nullable: true })
  description!: string;

  @Column({ nullable: true })
  thumbnail!: string;

  @Column({ nullable: true })
  image!: string;

  @Column({ name: 'min_players', default: 0 })
  minPlayers!: number;

  @Column({ name: 'max_players', default: 0 })
  maxPlayers!: number;

  @Column({ name: 'playing_time', default: 0 })
  playingTime!: number;

  @Column({ name: 'year_published', default: 0 })
  yearPublished!: number;

  // type: 'decimal' + precision/scale → stored as NUMERIC(4,2) in Postgres.
  // 'float' would introduce floating-point rounding errors for a value we
  // display to users (e.g. 8.7999999 instead of 8.8).
  @Column({ type: 'decimal', precision: 4, scale: 2, default: 0 })
  rating!: number;

  // last_fetched_at is set manually every time we refresh from BGG.
  // We do NOT use @UpdateDateColumn here — that would fire on any update
  // to this row (e.g. a future field we haven't added yet), which would
  // incorrectly reset the staleness clock without an actual BGG fetch.
  @Column({ name: 'last_fetched_at' })
  lastFetchedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
