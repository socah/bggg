import { Entity, PrimaryColumn } from 'typeorm';

@Entity('play_session_hosts')
export class PlaySessionHost {
  @PrimaryColumn({ name: 'session_id', type: 'uuid', primaryKeyConstraintName: 'play_session_hosts_pkey' })
  sessionId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'play_session_hosts_pkey' })
  userId!: string;
}
