import { CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Game } from '../games/game.entity';

@Entity('game_market_exclusions')
export class GameMarketExclusion {
  @PrimaryColumn({ name: 'game_id', type: 'integer' })
  gameId!: number;

  @PrimaryColumn({ type: 'text' })
  url!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game!: Game;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
