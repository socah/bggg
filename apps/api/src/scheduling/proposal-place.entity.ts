import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('proposal_places')
@Unique('proposal_places_proposal_id_place_id_key', ['proposalId', 'placeId'])
export class ProposalPlace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'proposal_id', type: 'uuid' })
  proposalId!: string;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId!: string;

  @Column({ name: 'proposed_by', type: 'text' })
  proposedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
