import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('proposal_place_votes')
@Check('proposal_place_votes_value_check', '"value" IN (-1, 1)')
export class ProposalPlaceVote {
  @PrimaryColumn({ name: 'proposal_place_id', type: 'uuid', primaryKeyConstraintName: 'proposal_place_votes_pkey' })
  proposalPlaceId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'proposal_place_votes_pkey' })
  userId!: string;

  @Column({ type: 'smallint', default: 1 })
  value!: -1 | 1;
}
