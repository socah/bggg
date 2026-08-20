import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('game_ownership') — join table between a person (raw Keycloak
// 'sub', same identity pattern as bgg_accounts.user_id above) and the
// shared 'games' catalogue. One row per game a user owns. The
// (user_id, game_id) uniqueness is enforced in db/schema.sql, the same way
// group_members' (user_id, group_id) uniqueness is — not via a TypeORM
// decorator, since nothing in this codebase relies on synchronize to create
// constraints (synchronize is false; schema.sql is applied by hand).
@Entity('game_ownership')
export class GameOwnership {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  // Bare column, not a @ManyToOne relation to Game — same "plain column, no
  // relation" choice GroupMember.groupId already made. Every query here is
  // "find this user's owned game ids" or "find owners of this game id";
  // neither needs TypeORM to eagerly load a full Game object through this row.
  @Column({ name: 'game_id' })
  gameId!: number;

  @CreateDateColumn({ name: 'added_at', type: 'date' })
  addedAt!: Date;
}
