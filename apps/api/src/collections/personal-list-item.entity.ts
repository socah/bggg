import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('personal_list_items')
export class PersonalListItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'list_id', type: 'uuid' })
  listId!: string;

  @Column({ name: 'game_id' })
  gameId!: number;

  @Column({ type: 'text', nullable: true })
  tier!: string | null;

  @Column({ type: 'integer' })
  position!: number;
}
