import { Entity, PrimaryColumn } from 'typeorm';

@Entity('proposal_place_votes')
export class ProposalPlaceVote {
  @PrimaryColumn({ name: 'proposal_place_id', type: 'uuid', primaryKeyConstraintName: 'proposal_place_votes_pkey' })
  proposalPlaceId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'proposal_place_votes_pkey' })
  userId!: string;
}
