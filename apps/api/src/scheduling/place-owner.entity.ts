import { Entity, PrimaryColumn } from 'typeorm';

@Entity('place_owners')
export class PlaceOwner {
  @PrimaryColumn({ name: 'place_id', type: 'uuid', primaryKeyConstraintName: 'place_owners_pkey' })
  placeId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'place_owners_pkey' })
  userId!: string;
}
