import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('place_visibility')
export class PlaceVisibility {
  @PrimaryColumn({ name: 'place_id', type: 'uuid', primaryKeyConstraintName: 'place_visibility_pkey' })
  placeId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'place_visibility_pkey' })
  userId!: string;

  @Column({ type: 'boolean', default: false })
  hidden!: boolean;
}
