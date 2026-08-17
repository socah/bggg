// Mirrors apps/api/src/groups/group.entity.ts's JSON shape (camelCase
// property names, since Nest serializes entity instances as-is).
export interface Group {
  id: string;
  name: string;
  ownerId: string;
  isSolo: boolean;
  createdAt: string;
}

// Mirrors apps/api/src/scheduling/play-session-proposal.entity.ts's JSON
// shape. confirmedStart/End arrive as ISO datetime strings (Date -> JSON);
// proposedDate arrives as a bare "YYYY-MM-DD" (SQL DATE column typed as
// `string` on the entity, so it's never wrapped in a Date server-side).
export type ProposalStatus = 'collecting' | 'confirming' | 'confirmed' | 'cancelled';

export interface Proposal {
  id: string;
  groupId: string;
  createdBy: string;
  proposedDate: string;
  hostId: string | null;
  status: ProposalStatus;
  confirmedStart: string | null;
  confirmedEnd: string | null;
  createdAt: string;
}

// The user-level (aggregate) space merges proposals from every group the
// user belongs to onto one grid — this is what lets a badge say which
// group it came from.
export interface ProposalWithGroup extends Proposal {
  groupName: string;
}

export interface Rsvp {
  id: number;
  proposalId: string;
  userId: string;
  status: 'yes' | 'maybe' | 'no';
  availableStart: string | null;
  availableEnd: string | null;
  confirmed: boolean;
}

// Only the fields the detail panel actually displays — apps/api/src/games/
// game.entity.ts has several more that the UI doesn't need yet.
export interface ProposalGameSummary {
  game: { id: number; name: string };
  voteCount: number;
}

export interface ProposalDetail {
  proposal: Proposal;
  rsvps: Rsvp[];
  games: ProposalGameSummary[];
}

export interface GroupMemberInfo {
  userId: string;
  displayName: string;
}
