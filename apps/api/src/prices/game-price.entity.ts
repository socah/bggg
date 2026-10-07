import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Game } from '../games/game.entity';
import { PriceOffer } from './price-analysis';
import { Attribution } from './retail-prices';

@Entity('game_price_sources')
@Check('game_price_sources_source_check', "source IN ('retail', 'market')")
export class GamePriceSource {
  @PrimaryColumn({ name: 'game_id', type: 'integer', primaryKeyConstraintName: 'game_price_sources_pkey' })
  gameId!: number;

  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'game_price_sources_pkey' })
  source!: 'retail' | 'market';

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id', foreignKeyConstraintName: 'game_price_sources_game_id_fkey' })
  game!: Game;

  @Column({ name: 'attempted_at', type: 'timestamptz' })
  attemptedAt!: Date;

  @Column({ name: 'fetched_at', type: 'timestamptz', nullable: true })
  fetchedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  offers!: PriceOffer[];

  @Column({ type: 'jsonb', nullable: true })
  attribution!: Attribution | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}

@Entity('game_price_history')
@Check('game_price_history_source_check', "source IN ('retail', 'market')")
export class GamePriceHistory {
  @PrimaryColumn({ name: 'game_id', type: 'integer', primaryKeyConstraintName: 'game_price_history_pkey' })
  gameId!: number;

  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'game_price_history_pkey' })
  source!: 'retail' | 'market';

  @PrimaryColumn({ type: 'date', primaryKeyConstraintName: 'game_price_history_pkey' })
  day!: string;

  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id', foreignKeyConstraintName: 'game_price_history_game_id_fkey' })
  game!: Game;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @Column({ type: 'jsonb' })
  offers!: PriceOffer[];
}
