import { describe, expect, it } from '@jest/globals';
import { rankMatchingSessions } from './sessions.service';
import type { PlaySession } from '../scheduling/play-session.entity';
import type { PlaySessionProposalGame } from '../scheduling/play-session-proposal-game.entity';
import type { PlaySessionRsvp } from '../scheduling/play-session-rsvp.entity';

function session(id: string, proposalId: string, hour: number): PlaySession {
  return { id, proposalId, groupId: 'group', playedAt: new Date(`2026-09-09T${String(hour).padStart(2, '0')}:00:00Z`) } as PlaySession;
}

describe('rankMatchingSessions', () => {
  it('prefers participant overlap before a suggested-game match', () => {
    const sessions = [session('suggested', 'proposal-a', 10), session('overlap', 'proposal-b', 12)];
    const rsvps = [
      { proposalId: 'proposal-a', userId: 'one', status: 'yes' },
      { proposalId: 'proposal-b', userId: 'one', status: 'yes' },
      { proposalId: 'proposal-b', userId: 'two', status: 'maybe' },
    ] as PlaySessionRsvp[];
    const games = [{ proposalId: 'proposal-a', gameId: 42 }] as PlaySessionProposalGame[];
    expect(rankMatchingSessions(sessions, rsvps, games, new Set(['one', 'two']), 42)[0].id).toBe('overlap');
  });

  it('uses a suggested-game match to break equal overlap', () => {
    const sessions = [session('plain', 'proposal-a', 10), session('suggested', 'proposal-b', 12)];
    const rsvps = [
      { proposalId: 'proposal-a', userId: 'one', status: 'yes' },
      { proposalId: 'proposal-b', userId: 'one', status: 'yes' },
    ] as PlaySessionRsvp[];
    const games = [{ proposalId: 'proposal-b', gameId: 42 }] as PlaySessionProposalGame[];
    expect(rankMatchingSessions(sessions, rsvps, games, new Set(['one']), 42)[0].id).toBe('suggested');
  });
});
