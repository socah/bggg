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

export interface CalendarParticipant {
  id: string;
  name: string;
  isWinner?: boolean;
}

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
  participants?: CalendarParticipant[];
  session?: { id: string; place: { id: string; name: string } | null } | null;
  canManage?: boolean;
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
  proposalGameId: string;
  game: GameCardGame;
  voteCount: number;
  votedByMe: boolean;
  downvotedByMe: boolean;
  proposedByMe: boolean;
}

export interface ProposalPlaceSummary {
  proposalPlaceId: string;
  place: { id: string; name: string };
  voteCount: number;
  votedByMe: boolean;
  downvotedByMe: boolean;
  proposedByMe: boolean;
  ownedByMe: boolean;
  ownerIds: string[];
}

export interface AvailablePlace {
  place: { id: string; name: string };
  ownedByMe: boolean;
  suggestionCount: number;
}

export interface ProposalDetail {
  proposal: Proposal;
  rsvps: Rsvp[];
  games: ProposalGameSummary[];
  places: ProposalPlaceSummary[];
  canManage: boolean;
  session?: { id: string; place: { id: string; name: string } | null } | null;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface PublicUserIdentity {
  id: string;
  username: string;
  displayName: string;
  nickname?: string | null;
}

// Mirrors apps/api getMembers: Keycloak display info + the member's
// group_members.role, which drives which lifecycle controls the panel shows.
export interface GroupMemberInfo extends PublicUserIdentity {
  role: MemberRole;
  isCurrentUser?: boolean;
  firstName?: string;
  bggUsername?: string | null;
}

export interface GroupMemberProfile extends GroupMemberInfo {
  collection: CollectionGame[];
  wishlist: CollectionGame[];
  saved: CollectionGame[];
  lists: PersonalGameList[];
  reviews: PersonalReview[];
}

export type ChatThreadKind = 'general' | 'proposal' | 'direct';

export interface ChatThread {
  id: string;
  groupId: string | null;
  kind: ChatThreadKind;
  proposalId: string | null;
  directUserA: string | null;
  directUserB: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ChatThreadSummary extends ChatThread {
  lastMessage: ChatMessage | null;
}

export interface GameCardGame {
  id: number;
  bggId: number;
  name: string;
  image: string | null;
  thumbnail: string | null;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
  yearPublished: number;
  rating: number;
  owners?: PublicUserIdentity[];
}

export interface CollectionGame extends GameCardGame {
  source: 'manual' | 'bgg';
  addedAt: string;
  wishlistPriority?: number;
}

export interface PersonalListGame extends GameCardGame {
  tier: string | null;
  position: number;
}

export interface PersonalGameList {
  id: string;
  name: string;
  type: 'custom' | 'tier';
  tiers: string[];
  items: PersonalListGame[];
  createdAt: string;
  updatedAt: string;
}

export interface PersonalReview {
  id: number;
  gameId: number;
  rating: number | null;
  complexityScore: number | null;
  depthScore: number | null;
  body: string | null;
  source: 'manual' | 'bgg';
  updatedAt: string;
}

export interface GameReview {
  id: number;
  userId: string;
  displayName: string;
  nickname?: string | null;
  username: string;
  profileGroupId: string | null;
  isMine: boolean;
  rating: number | null;
  complexityScore: number | null;
  depthScore: number | null;
  body: string | null;
  source: 'manual' | 'bgg';
  updatedAt: string;
}

export interface GamePlaySummary {
  id: string;
  sessionId: string;
  groupId: string;
  playedAt: string;
  notes: string | null;
  status: 'finished' | 'abandoned';
  durationMinutes: number | null;
  startedAt: string | null;
  endedAt: string | null;
  canEdit: boolean;
  groupName: string;
  photos: Array<{ id: string; playId: string; url: string }>;
}

export interface CalendarPlaySummary {
  id: string;
  sessionId: string;
  proposalId: string | null;
  groupId: string;
  groupName: string;
  game: GameCardGame;
  playedDate: string;
  status: 'finished' | 'abandoned';
  durationMinutes: number | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  canEdit: boolean;
  sessionParticipants: CalendarParticipant[];
  playParticipants: CalendarParticipant[];
  sessionPlace: { id: string; name: string } | null;
}

export interface GamePrivateDetails {
  comment: string | null;
  amountPaid: number | null;
}

export interface CollectionGameDetails {
  game: GameCardGame;
  privateDetails: GamePrivateDetails;
  reviews: GameReview[];
  plays: GamePlaySummary[];
}

export interface BggSearchResult {
  bggId: number;
  name: string;
  yearPublished: number;
  thumbnail: string;
}

// Body of PUT /proposals/:id/rsvp. Times are optional HH:mm (24h) —
// omitted means the server applies the Decision G default window
// (10:00–02:00 next day) anchored to the proposal's date.
export interface RsvpInput {
  status: Rsvp['status'];
  availableStart?: string;
  availableEnd?: string;
}

// One row of GET /groups/:groupId/games — the propose-a-game picker's data.
export interface GroupLibraryGame extends GameCardGame {
  bggId: number;
  owners?: PublicUserIdentity[];
  averageUserRating: number | null;
  averageComplexity: number | null;
  averageDepth: number | null;
}
