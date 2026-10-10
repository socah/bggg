import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('game_private_details')
export class GamePrivateDetails {
  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @PrimaryColumn({ name: 'game_id', type: 'integer' })
  gameId!: number;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'amount_paid', type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: {
    to: (value: number | null) => value,
    from: (value: string | null) => value === null ? null : Number(value),
  } })
  amountPaid!: number | null;

  @Column({ name: 'date_acquired', type: 'date', nullable: true })
  dateAcquired!: string | null;
}
