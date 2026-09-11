import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlaySessionProposal } from './play-session-proposal.entity';
import { PlaySessionRsvp } from './play-session-rsvp.entity';
import { PlaySession } from './play-session.entity';
import { PlaySessionProposalGame } from './play-session-proposal-game.entity';
import { PlaySessionProposalGameVote } from './play-session-proposal-game-vote.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Game } from '../games/game.entity';
import { Place } from './place.entity';
import { PlaceOwner } from './place-owner.entity';
import { PlaceVisibility } from './place-visibility.entity';
import { ProposalPlace } from './proposal-place.entity';
import { ProposalPlaceVote } from './proposal-place-vote.entity';
import { PlaySessionHost } from './play-session-host.entity';
import { PlaySessionGame } from './play-session-game.entity';
import { GroupsService } from '../groups/groups.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { ProposeGameDto } from './dto/propose-game.dto';
import { SuggestPlaceDto } from './dto/suggest-place.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';
import { computeOverlapWindow, NoOverlapError } from './overlap-window';
import { resolveAvailabilityWindow } from './resolve-window';
import { NotificationsService } from '../notifications/notifications.service';

// One entry of GET /proposals/:id/games (and the games array inside
// GET /proposals/:id). proposalGameId is the join-row id the vote
// endpoints address; votedByMe lets the UI render the caller's own vote
// state without a second request.
export interface ProposalGameWithVotes {
  proposalGameId: string;
  game: Pick<Game, 'id' | 'bggId' | 'name' | 'minPlayers' | 'maxPlayers' | 'playingTime' | 'yearPublished' | 'rating'> & { image: string | null; thumbnail: string | null };
  voteCount: number;
  votedByMe: boolean;
  downvotedByMe: boolean;
  proposedByMe: boolean;
}

export interface ProposalPlaceWithVotes {
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
  canEdit: boolean;
  suggestionCount: number;
}

export interface GroupHostingStats {
  totalSessionCount: number;
  hosts: { userId: string; hostedSessionCount: number }[];
}

@Injectable()
export class SchedulingService {
  constructor(
    @InjectRepository(PlaySessionProposal)
    private readonly proposals: Repository<PlaySessionProposal>,
    @InjectRepository(PlaySessionRsvp)
    private readonly rsvps: Repository<PlaySessionRsvp>,
    @InjectRepository(PlaySession)
    private readonly sessions: Repository<PlaySession>,
    @InjectRepository(PlaySessionProposalGame)
    private readonly proposalGames: Repository<PlaySessionProposalGame>,
    @InjectRepository(PlaySessionProposalGameVote)
    private readonly gameVotes: Repository<PlaySessionProposalGameVote>,
    // Read-only here — used purely to resolve a proposal-game row's gameId
    // into the game's actual name for listProposalGames' response.
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(Place)
    private readonly places: Repository<Place>,
    @InjectRepository(PlaceOwner)
    private readonly placeOwners: Repository<PlaceOwner>,
    @InjectRepository(PlaceVisibility)
    private readonly placeVisibility: Repository<PlaceVisibility>,
    @InjectRepository(ProposalPlace)
    private readonly proposalPlaces: Repository<ProposalPlace>,
    @InjectRepository(ProposalPlaceVote)
    private readonly placeVotes: Repository<ProposalPlaceVote>,
    @InjectRepository(PlaySessionHost)
    private readonly sessionHosts: Repository<PlaySessionHost>,
    @InjectRepository(PlaySessionGame)
    private readonly sessionGames: Repository<PlaySessionGame>,
    // Own registration of GroupMember, same "each module registers its own
    // repository for a shared entity" pattern InvitesModule already uses —
    // see the comment in groups.module.ts.
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    // For "is this user even a member of this group" checks — reused
    // rather than reimplemented, same reasoning as ChatService injecting
    // GroupsService instead of querying GroupMember itself.
    private readonly groupsService: GroupsService,
    private readonly notifications: NotificationsService,
  ) {}

  async createProposal(
    groupId: string,
    dto: CreateProposalDto,
    requestingUserId: string,
  ): Promise<PlaySessionProposal> {
    // Throws NotFound/Forbidden if the group doesn't exist or this user
    // isn't a member — any member can propose a game night, not just
    // owners/admins.
    await this.groupsService.findOne(groupId, requestingUserId);

    const proposal = await this.proposals.save(
      this.proposals.create({
        groupId,
        createdBy: requestingUserId,
        proposedDate: dto.proposedDate,
        status: 'collecting',
      }),
    );

    // The creator is automatically 'yes', with the Decision G default
    // window — they picked the day, so "are you free" is already answered
    // for them.
    const { start, end } = resolveAvailabilityWindow(proposal.proposedDate, undefined, undefined);
    await this.rsvps.save(
      this.rsvps.create({
        proposalId: proposal.id,
        userId: requestingUserId,
        status: 'yes',
        availableStart: start,
        availableEnd: end,
      }),
    );

    this.notifyProposal(proposal, requestingUserId, 'A new proposal was created');
    return proposal;
  }

  async rsvp(
    proposalId: string,
    dto: RsvpDto,
    requestingUserId: string,
  ): Promise<PlaySessionRsvp> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    // RSVPs only make sense while still collecting — once confirmation has
    // been requested, the trimmed window is already computed and stored;
    // changing an answer underneath that would need an explicit undo first
    // (Decision B).
    if (proposal.status !== 'collecting') {
      throw new ConflictException('RSVPs are closed once confirmation has been requested');
    }

    let availableStart: Date | null = null;
    let availableEnd: Date | null = null;
    if (dto.status !== 'no') {
      const window = resolveAvailabilityWindow(
        proposal.proposedDate,
        dto.availableStart,
        dto.availableEnd,
      );
      availableStart = window.start;
      availableEnd = window.end;
    }

    // Upsert by (proposalId, userId) — the second RSVP from the same
    // person updates this row rather than inserting a new one, enforced at
    // the database level by the UNIQUE constraint on PlaySessionRsvp.
    const existing = await this.rsvps.findOneBy({ proposalId, userId: requestingUserId });
    const rsvp = existing
      ? Object.assign(existing, { status: dto.status, availableStart, availableEnd })
      : this.rsvps.create({
          proposalId,
          userId: requestingUserId,
          status: dto.status,
          availableStart,
          availableEnd,
        });

    const saved = await this.rsvps.save(rsvp);
    this.notifyProposal(proposal, requestingUserId, 'An RSVP changed');
    return saved;
  }

  // POST /proposals/:id/request-confirmation — normally the 'collecting' ->
  // 'confirming' transition (Decision B, step 2). A sole attendee goes
  // directly to 'confirmed' because there is nobody else to lock in.
  async requestConfirmation(
    proposalId: string,
    requestingUserId: string,
  ): Promise<PlaySessionProposal> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    if (proposal.status !== 'collecting') {
      throw new ConflictException(`Cannot request confirmation from status '${proposal.status}'`);
    }

    const proposalRsvps = await this.rsvps.findBy({ proposalId });
    const windows = proposalRsvps
      .filter((r) => r.status === 'yes')
      .filter((r): r is PlaySessionRsvp & { availableStart: Date; availableEnd: Date } =>
        r.availableStart !== null && r.availableEnd !== null,
      )
      .map((r) => ({ userId: r.userId, start: r.availableStart, end: r.availableEnd }));

    let window: { start: Date; end: Date };
    try {
      const suggestedPlaces = await this.proposalPlaces.findBy({ proposalId });
      const owners = suggestedPlaces.length === 0
        ? []
        : await this.placeOwners.findBy({ placeId: In(suggestedPlaces.map((row) => row.placeId)) });
      const hostIds = [...new Set(owners.map((owner) => owner.userId))];
      window = computeOverlapWindow(windows, hostIds);
    } catch (err) {
      // NoOverlapError means "no valid session window exists yet" — a
      // client-fixable state (more RSVPs needed, or conflicting windows),
      // so it surfaces as 409, not a 500.
      if (err instanceof NoOverlapError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    proposal.confirmedStart = window.start;
    proposal.confirmedEnd = window.end;
    const participants = proposalRsvps.filter((rsvp) => rsvp.status !== 'no');
    if (participants.length === 1) {
      if (participants[0].userId !== requestingUserId) {
        throw new ForbiddenException('Only the sole attendee can confirm this proposal');
      }
      await this.createSessionForProposal(proposal);
      proposal.status = 'confirmed';
      const saved = await this.proposals.save(proposal);
      this.notifyProposal(saved, requestingUserId, 'The proposal was confirmed');
      return saved;
    }

    proposal.status = 'confirming';
    const saved = await this.proposals.save(proposal);
    this.notifyProposal(saved, requestingUserId, 'Confirmation was requested');
    return saved;
  }

  // PATCH /proposals/:id/rsvp/lock-in — the per-user lock-in step
  // (Decision B, step 3). Only meaningful during 'confirming'; a 'no' RSVP
  // has nothing to lock in.
  async lockIn(
    proposalId: string,
    requestingUserId: string,
    confirmed: boolean,
  ): Promise<PlaySessionRsvp> {
    const proposal = await this.findProposalOrThrow(proposalId);

    if (proposal.status !== 'confirming') {
      throw new ConflictException('Locking in is only possible while awaiting confirmation');
    }

    const rsvp = await this.rsvps.findOneBy({ proposalId, userId: requestingUserId });
    if (!rsvp || rsvp.status === 'no') {
      throw new ForbiddenException('Only yes/maybe RSVP holders can lock in');
    }

    rsvp.confirmed = confirmed;
    const saved = await this.rsvps.save(rsvp);
    this.notifyProposal(proposal, requestingUserId, 'A participant changed their confirmation');
    return saved;
  }

  // POST /proposals/:id/finalize — the 'confirming' -> 'confirmed'
  // transition (Decision B, step 4). Still a deliberate, separate action
  // from locking in — per-RSVP confirmed flags are a signal the creator
  // reads, not a mechanical gate that finalizes on its own.
  async finalize(proposalId: string, requestingUserId: string): Promise<PlaySession> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    if (proposal.status !== 'confirming' || !proposal.confirmedStart) {
      throw new ConflictException(`Cannot finalize from status '${proposal.status}'`);
    }

    const session = await this.createSessionForProposal(proposal);

    proposal.status = 'confirmed';
    await this.proposals.save(proposal);
    this.notifyProposal(proposal, requestingUserId, 'The proposal was confirmed');

    return session;
  }

  // POST /proposals/:id/undo — rolls 'confirming' or 'confirmed' back to
  // 'collecting' (Decision B, step 5).
  async undo(proposalId: string, requestingUserId: string): Promise<PlaySessionProposal> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    if (proposal.status === 'collecting') {
      throw new ConflictException('Proposal is already in collecting status');
    }

    // Retain compatibility with previously persisted cancelled rows.
    if (proposal.status === 'cancelled') {
      throw new ConflictException('A cancelled proposal cannot be un-cancelled');
    }

    // Delete the play_sessions row BEFORE the proposal loses its
    // 'confirmed' status — a confirmed-status session backed by a
    // collecting proposal is exactly the inconsistency this ordering
    // avoids (see the schema.sql comment on play_sessions.proposal_id).
    if (proposal.status === 'confirmed') {
      const session = await this.sessions.findOneBy({ proposalId: proposal.id });
      if (session) {
        if (await this.sessionGames.existsBy({ sessionId: session.id })) {
          session.proposalId = null;
          await this.sessions.save(session);
        } else {
          await this.sessions.remove(session);
        }
      }
    }

    await this.rsvps.update({ proposalId: proposal.id }, { confirmed: false });

    proposal.status = 'collecting';
    proposal.confirmedStart = null;
    proposal.confirmedEnd = null;
    const saved = await this.proposals.save(proposal);
    this.notifyProposal(saved, requestingUserId, 'The proposal was reopened');
    return saved;
  }

  async removeProposal(proposalId: string, requestingUserId: string): Promise<void> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    const session = await this.sessions.findOneBy({ proposalId });
    if (session) {
      if (await this.sessionGames.existsBy({ sessionId: session.id })) {
        session.proposalId = null;
        await this.sessions.save(session);
      } else {
        await this.sessions.remove(session);
      }
    }
    await this.proposals.remove(proposal);
    this.notifyProposal(proposal, requestingUserId, 'The proposal was deleted');
  }

  async proposeGame(
    proposalId: string,
    dto: ProposeGameDto,
    requestingUserId: string,
  ): Promise<PlaySessionProposalGame> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);

    // UNIQUE (proposal_id, game_id) means a second "propose" of the same
    // game is a no-op, not an error — further interest is a vote, not a
    // duplicate proposal.
    const existing = await this.proposalGames.findOneBy({ proposalId, gameId: dto.gameId });
    if (existing) return existing;

    const saved = await this.proposalGames.save(
      this.proposalGames.create({
        proposalId,
        gameId: dto.gameId,
        proposedBy: requestingUserId,
      }),
    );
    this.notifyProposal(proposal, requestingUserId, 'A game was suggested');
    return saved;
  }

  async voteForGame(proposalId: string, proposalGameId: string, requestingUserId: string, value: -1 | 1): Promise<void> {
    const proposalGame = await this.proposalGames.findOneBy({ id: proposalGameId, proposalId });
    if (!proposalGame) throw new NotFoundException('Proposed game not found');

    const proposal = await this.findProposalOrThrow(proposalGame.proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);

    const existing = await this.gameVotes.findOneBy({ proposalGameId, userId: requestingUserId });
    if (existing) {
      if (existing.value === value) return;
      existing.value = value;
      await this.gameVotes.save(existing);
      this.notifyProposal(proposal, requestingUserId, 'A game vote changed');
      return;
    }

    await this.gameVotes.save(this.gameVotes.create({ proposalGameId, userId: requestingUserId, value }));
    this.notifyProposal(proposal, requestingUserId, 'A game vote changed');
  }

  async unvoteForGame(proposalId: string, proposalGameId: string, requestingUserId: string): Promise<void> {
    const proposalGame = await this.proposalGames.findOneBy({ id: proposalGameId, proposalId });
    if (!proposalGame) throw new NotFoundException('Proposed game not found');

    const proposal = await this.findProposalOrThrow(proposalGame.proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);

    const result = await this.gameVotes.delete({ proposalGameId, userId: requestingUserId });
    if (result.affected) this.notifyProposal(proposal, requestingUserId, 'A game vote changed');
  }

  async removeProposalGame(proposalId: string, proposalGameId: string, requestingUserId: string): Promise<void> {
    const proposalGame = await this.proposalGames.findOneBy({ id: proposalGameId, proposalId });
    if (!proposalGame) throw new NotFoundException('Proposed game not found');
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);
    if (proposalGame.proposedBy !== requestingUserId) {
      throw new ForbiddenException('You can only remove games you suggested');
    }
    await this.proposalGames.remove(proposalGame);
    this.notifyProposal(proposal, requestingUserId, 'A suggested game was removed');
  }

  async listProposalGames(
    proposalId: string,
    requestingUserId: string,
  ): Promise<ProposalGameWithVotes[]> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    const proposalGames = await this.proposalGames.findBy({ proposalId });
    if (proposalGames.length === 0) return [];

    // Resolve each join row's gameId to the real Game entity in one query,
    // rather than duplicating the games table's id/name onto every
    // proposal-game row — the join row itself only tracks who proposed
    // which game, not the game's own data.
    const gameEntities = await this.games.findBy({
      id: In(proposalGames.map((pg) => pg.gameId)),
    });
    const gameById = new Map(gameEntities.map((g) => [g.id, g]));

    // Vote count is derived with COUNT(*) (Decision E) — never a stored
    // column — so there's a query per game here rather than a join. Fine
    // at this project's scale; would become a single GROUP BY if the
    // number of proposed games per proposal ever got large.
    const rows = await Promise.all(
      proposalGames.map(async (proposalGame) => {
        const game = gameById.get(proposalGame.gameId);
        const votes = await this.gameVotes.findBy({ proposalGameId: proposalGame.id });
        const myVote = votes.find((vote) => vote.userId === requestingUserId)?.value ?? 0;
        return {
        proposalGameId: proposalGame.id,
        game: {
          id: proposalGame.gameId,
          bggId: game?.bggId ?? 0,
          name: game?.name ?? 'Unknown game',
          image: game?.image ?? null,
          thumbnail: game?.thumbnail ?? null,
          minPlayers: game?.minPlayers ?? 0,
          maxPlayers: game?.maxPlayers ?? 0,
          playingTime: game?.playingTime ?? 0,
          yearPublished: game?.yearPublished ?? 0,
          rating: game?.rating ?? 0,
        },
        voteCount: votes.reduce((total, vote) => total + vote.value, 0),
        votedByMe: myVote === 1,
        downvotedByMe: myVote === -1,
        proposedByMe: proposalGame.proposedBy === requestingUserId,
      };
      }),
    );
    return rows.sort(
      (left, right) =>
        right.voteCount - left.voteCount ||
        left.game.name.localeCompare(right.game.name) ||
        left.proposalGameId.localeCompare(right.proposalGameId),
    );
  }

  async suggestPlace(
    proposalId: string,
    dto: SuggestPlaceDto,
    requestingUserId: string,
  ): Promise<ProposalPlace> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);

    if ((dto.placeId === undefined) === (dto.name === undefined)) {
      throw new BadRequestException('Provide exactly one of placeId or name');
    }

    let place: Place;
    if (dto.placeId) {
      const available = await this.listAvailablePlaces(requestingUserId);
      if (!available.some((row) => row.place.id === dto.placeId)) {
        throw new NotFoundException('Available place not found');
      }
      const found = await this.places.findOneBy({ id: dto.placeId });
      if (!found) throw new NotFoundException('Place not found');
      place = found;
    } else {
      place = await this.places.save(
        this.places.create({ name: dto.name!.trim(), createdBy: requestingUserId }),
      );
    }

    const existing = await this.proposalPlaces.findOneBy({ proposalId, placeId: place.id });
    const proposalPlace = existing ?? await this.proposalPlaces.save(
      this.proposalPlaces.create({ proposalId, placeId: place.id, proposedBy: requestingUserId }),
    );

    const members = await this.members.findBy({ groupId: proposal.groupId });
    await this.placeVisibility.upsert(
      members.map((member) => ({ placeId: place.id, userId: member.userId })),
      ['placeId', 'userId'],
    );
    if (!existing) this.notifyProposal(proposal, requestingUserId, 'A place was suggested');
    return proposalPlace;
  }

  async listProposalPlaces(
    proposalId: string,
    requestingUserId: string,
  ): Promise<ProposalPlaceWithVotes[]> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    const rows = await this.proposalPlaces.findBy({ proposalId });
    if (rows.length === 0) return [];

    const places = await this.places.findBy({ id: In(rows.map((row) => row.placeId)) });
    const placeById = new Map(places.map((place) => [place.id, place]));
    const owners = await this.placeOwners.findBy({ placeId: In(rows.map((row) => row.placeId)) });
    const ownerIdsByPlace = new Map<string, string[]>();
    for (const owner of owners) {
      ownerIdsByPlace.set(owner.placeId, [...(ownerIdsByPlace.get(owner.placeId) ?? []), owner.userId]);
    }

    const result = await Promise.all(rows.map(async (row) => {
      const ownerIds = (ownerIdsByPlace.get(row.placeId) ?? []).sort();
      const votes = await this.placeVotes.findBy({ proposalPlaceId: row.id });
      const myVote = votes.find((vote) => vote.userId === requestingUserId)?.value ?? 0;
      return {
        proposalPlaceId: row.id,
        place: { id: row.placeId, name: placeById.get(row.placeId)?.name ?? 'Unknown place' },
        voteCount: votes.reduce((total, vote) => total + vote.value, 0),
        votedByMe: myVote === 1,
        downvotedByMe: myVote === -1,
        proposedByMe: row.proposedBy === requestingUserId,
        ownedByMe: ownerIds.includes(requestingUserId),
        ownerIds,
      };
    }));
    return result.sort((left, right) =>
      right.voteCount - left.voteCount ||
      left.place.name.localeCompare(right.place.name) ||
      left.proposalPlaceId.localeCompare(right.proposalPlaceId),
    );
  }

  async listAvailablePlaces(
    requestingUserId: string,
  ): Promise<AvailablePlace[]> {
    const [owned, visible, memberships] = await Promise.all([
      this.placeOwners.findBy({ userId: requestingUserId }),
      this.placeVisibility.findBy({ userId: requestingUserId }),
      this.members.findBy({ userId: requestingUserId }),
    ]);
    const groupIds = memberships.map((membership) => membership.groupId);
    const accessibleProposals = groupIds.length === 0
      ? []
      : await this.proposals.findBy({ groupId: In(groupIds) });
    const accessibleSuggestions = accessibleProposals.length === 0
      ? []
      : await this.proposalPlaces.findBy({
          proposalId: In(accessibleProposals.map((accessible) => accessible.id)),
        });

    const hiddenIds = new Set(visible.filter((row) => row.hidden).map((row) => row.placeId));
    const placeIds = new Set([
      ...owned.map((row) => row.placeId),
      ...visible.filter((row) => !row.hidden).map((row) => row.placeId),
      ...accessibleSuggestions.map((row) => row.placeId),
    ].filter((placeId) => !hiddenIds.has(placeId)));
    if (placeIds.size === 0) return [];

    const visibleIds = new Set(visible.map((row) => row.placeId));
    const discoveredIds = [...placeIds].filter((placeId) => !visibleIds.has(placeId));
    if (discoveredIds.length > 0) {
      await this.placeVisibility.upsert(
        discoveredIds.map((placeId) => ({ placeId, userId: requestingUserId, hidden: false })),
        ['placeId', 'userId'],
      );
    }

    const places = await this.places.findBy({ id: In([...placeIds]) });
    const ownedIds = new Set(owned.map((row) => row.placeId));
    const result = await Promise.all(places.map(async (place) => ({
      place: { id: place.id, name: place.name },
      ownedByMe: ownedIds.has(place.id),
      canEdit: place.createdBy === requestingUserId,
      suggestionCount: await this.proposalPlaces.countBy({ placeId: place.id }),
    })));
    return result.sort((left, right) =>
      Number(right.ownedByMe) - Number(left.ownedByMe) ||
      right.suggestionCount - left.suggestionCount ||
      left.place.name.localeCompare(right.place.name) ||
      left.place.id.localeCompare(right.place.id),
    );
  }

  async listAvailablePlacesForProposal(
    proposalId: string,
    requestingUserId: string,
  ): Promise<AvailablePlace[]> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    return this.listAvailablePlaces(requestingUserId);
  }

  async voteForPlace(
    proposalId: string,
    proposalPlaceId: string,
    requestingUserId: string,
    value: -1 | 1,
  ): Promise<void> {
    const { proposal } = await this.findProposalPlaceOrThrow(proposalId, proposalPlaceId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);
    const existing = await this.placeVotes.findOneBy({ proposalPlaceId, userId: requestingUserId });
    if (existing) {
      if (existing.value === value) return;
      existing.value = value;
      await this.placeVotes.save(existing);
      this.notifyProposal(proposal, requestingUserId, 'A place vote changed');
      return;
    }
    await this.placeVotes.save(this.placeVotes.create({ proposalPlaceId, userId: requestingUserId, value }));
    this.notifyProposal(proposal, requestingUserId, 'A place vote changed');
  }

  async unvoteForPlace(
    proposalId: string,
    proposalPlaceId: string,
    requestingUserId: string,
  ): Promise<void> {
    const { proposal } = await this.findProposalPlaceOrThrow(proposalId, proposalPlaceId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);
    const result = await this.placeVotes.delete({ proposalPlaceId, userId: requestingUserId });
    if (result.affected) this.notifyProposal(proposal, requestingUserId, 'A place vote changed');
  }

  async removeProposalPlace(
    proposalId: string,
    proposalPlaceId: string,
    requestingUserId: string,
  ): Promise<void> {
    const { proposal, proposalPlace } = await this.findProposalPlaceOrThrow(proposalId, proposalPlaceId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);
    if (proposalPlace.proposedBy !== requestingUserId) {
      throw new ForbiddenException('You can only remove places you suggested');
    }
    await this.proposalPlaces.remove(proposalPlace);
    this.notifyProposal(proposal, requestingUserId, 'A suggested place was removed');
  }

  async removeSavedPlace(placeId: string, requestingUserId: string): Promise<void> {
    if (!(await this.places.findOneBy({ id: placeId }))) {
      throw new NotFoundException('Place not found');
    }
    await this.placeVisibility.upsert(
      { placeId, userId: requestingUserId, hidden: true },
      ['placeId', 'userId'],
    );
  }

  async updatePlace(
    placeId: string,
    dto: UpdatePlaceDto,
    requestingUserId: string,
  ): Promise<{ id: string; name: string }> {
    const place = await this.places.findOneBy({ id: placeId });
    if (!place) throw new NotFoundException('Place not found');
    if (place.createdBy !== requestingUserId) {
      throw new ForbiddenException('You can only rename places you created');
    }

    place.name = dto.name.trim();
    const updated = await this.places.save(place);
    return { id: updated.id, name: updated.name };
  }

  async markPlaceOwned(
    proposalId: string,
    proposalPlaceId: string,
    requestingUserId: string,
  ): Promise<void> {
    const { proposal, proposalPlace } = await this.findProposalPlaceOrThrow(proposalId, proposalPlaceId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);
    await this.placeOwners.upsert(
      { placeId: proposalPlace.placeId, userId: requestingUserId },
      ['placeId', 'userId'],
    );
    await this.placeVisibility.upsert(
      { placeId: proposalPlace.placeId, userId: requestingUserId, hidden: false },
      ['placeId', 'userId'],
    );
  }

  async unmarkPlaceOwned(
    proposalId: string,
    proposalPlaceId: string,
    requestingUserId: string,
  ): Promise<void> {
    const { proposal, proposalPlace } = await this.findProposalPlaceOrThrow(proposalId, proposalPlaceId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);
    this.assertCollecting(proposal);
    await this.placeOwners.delete({ placeId: proposalPlace.placeId, userId: requestingUserId });
  }

  private notifyProposal(proposal: PlaySessionProposal, actorId: string, message: string): void {
    void this.notifications.notifyProposalUpdate(proposal, actorId, message);
  }

  async listProposals(groupId: string, requestingUserId: string) {
    await this.groupsService.findOne(groupId, requestingUserId);
    const proposals = await this.proposals.find({ where: { groupId }, order: { createdAt: 'DESC' } });
    if (proposals.length === 0) return [];
    const [rsvps, members] = await Promise.all([
      this.rsvps.findBy({ proposalId: In(proposals.map((proposal) => proposal.id)) }),
      this.groupsService.getMembers(groupId, requestingUserId),
    ]);
    const sessions = await this.sessions.findBy({ proposalId: In(proposals.map((proposal) => proposal.id)) });
    const placeIds = sessions.flatMap((session) => session.placeId ? [session.placeId] : []);
    const sessionPlaces = placeIds.length ? await this.places.findBy({ id: In(placeIds) }) : [];
    const memberById = new Map(members.map((member) => [member.id, member]));
    const requestingMember = members.find((member) => member.id === requestingUserId);
    const sessionByProposal = new Map(sessions.map((session) => [session.proposalId, session]));
    const placeById = new Map(sessionPlaces.map((place) => [place.id, place]));
    return proposals.map((proposal) => ({
      ...proposal,
      participants: rsvps
        .filter((rsvp) => rsvp.proposalId === proposal.id && (rsvp.status === 'yes' || rsvp.confirmed))
        .map((rsvp) => {
          const member = memberById.get(rsvp.userId);
          return { id: `user:${rsvp.userId}`, name: member?.displayName || member?.username || 'Unknown member' };
        }),
      session: (() => {
        const session = sessionByProposal.get(proposal.id);
        if (!session) return null;
        const place = session.placeId ? placeById.get(session.placeId) : null;
        return { id: session.id, place: place ? { id: place.id, name: place.name } : null };
      })(),
      canManage: proposal.createdBy === requestingUserId || requestingMember?.role === 'owner' || requestingMember?.role === 'admin',
    }));
  }

  async getMyHostingStats(requestingUserId: string): Promise<{ hostedSessionCount: number }> {
    return { hostedSessionCount: await this.sessionHosts.countBy({ userId: requestingUserId }) };
  }

  async getGroupHostingStats(
    groupId: string,
    requestingUserId: string,
  ): Promise<GroupHostingStats> {
    await this.groupsService.findOne(groupId, requestingUserId);

    const [totalSessionCount, rows] = await Promise.all([
      this.sessions.countBy({ groupId }),
      this.sessionHosts
        .createQueryBuilder('host')
        .innerJoin(PlaySession, 'session', 'session.id = host.session_id')
        .select('host.user_id', 'userId')
        .addSelect('COUNT(*)', 'hostedSessionCount')
        .where('session.group_id = :groupId', { groupId })
        .groupBy('host.user_id')
        .orderBy('COUNT(*)', 'DESC')
        .addOrderBy('host.user_id', 'ASC')
        .getRawMany<{ userId: string; hostedSessionCount: string }>(),
    ]);

    return {
      totalSessionCount,
      hosts: rows.map((row) => ({
        userId: row.userId,
        hostedSessionCount: Number(row.hostedSessionCount),
      })),
    };
  }

  async getMemberHostingStats(
    groupId: string,
    userId: string,
    requestingUserId: string,
  ): Promise<{ hostedSessionCount: number }> {
    await this.groupsService.findOne(groupId, requestingUserId);
    const membership = await this.members.findOneBy({ groupId, userId });
    if (!membership) throw new NotFoundException('Group member not found');

    const sessions = await this.sessions.findBy({ groupId });
    if (sessions.length === 0) return { hostedSessionCount: 0 };
    return {
      hostedSessionCount: await this.sessionHosts.countBy({
        userId,
        sessionId: In(sessions.map((session) => session.id)),
      }),
    };
  }

  async getProposal(
    proposalId: string,
    requestingUserId: string,
  ): Promise<{
    proposal: PlaySessionProposal;
    rsvps: PlaySessionRsvp[];
    games: ProposalGameWithVotes[];
    places: ProposalPlaceWithVotes[];
    canManage: boolean;
    session: { id: string; place: { id: string; name: string } | null } | null;
  }> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    const rsvps = await this.rsvps.findBy({ proposalId });
    // Reuses listProposalGames' own vote-counting logic rather than
    // duplicating it — the redundant proposal/membership re-check inside it
    // is cheap at this project's scale and keeps this a one-line call
    // instead of extracting a shared private helper for one caller.
    const games = await this.listProposalGames(proposalId, requestingUserId);
    const places = await this.listProposalPlaces(proposalId, requestingUserId);
    const canManage = await this.canManageProposal(proposal, requestingUserId);
    const session = await this.sessions.findOneBy({ proposalId });
    const sessionPlace = session?.placeId ? await this.places.findOneBy({ id: session.placeId }) : null;
    return {
      proposal,
      rsvps,
      games,
      places,
      canManage,
      session: session ? { id: session.id, place: sessionPlace ? { id: sessionPlace.id, name: sessionPlace.name } : null } : null,
    };
  }

  private async findProposalOrThrow(proposalId: string): Promise<PlaySessionProposal> {
    const proposal = await this.proposals.findOneBy({ id: proposalId });
    if (!proposal) throw new NotFoundException(`Proposal ${proposalId} not found`);
    return proposal;
  }

  private async findProposalPlaceOrThrow(
    proposalId: string,
    proposalPlaceId: string,
  ): Promise<{ proposal: PlaySessionProposal; proposalPlace: ProposalPlace }> {
    const proposal = await this.findProposalOrThrow(proposalId);
    const proposalPlace = await this.proposalPlaces.findOneBy({ id: proposalPlaceId, proposalId });
    if (!proposalPlace) throw new NotFoundException('Suggested place not found on this proposal');
    return { proposal, proposalPlace };
  }

  private assertCollecting(proposal: PlaySessionProposal): void {
    if (proposal.status !== 'collecting') {
      throw new ConflictException('Suggestions and votes can only be changed while the proposal is collecting');
    }
  }

  private async createSessionForProposal(proposal: PlaySessionProposal): Promise<PlaySession> {
    const session = await this.sessions.save(
      this.sessions.create({
        groupId: proposal.groupId,
        playedAt: proposal.confirmedStart!,
        proposalId: proposal.id,
      }),
    );

    const suggestedPlaces = await this.proposalPlaces.findBy({ proposalId: proposal.id });
    if (suggestedPlaces.length > 0) {
      const owners = await this.placeOwners.findBy({
        placeId: In(suggestedPlaces.map((row) => row.placeId)),
      });
      const hostIds = [...new Set(owners.map((owner) => owner.userId))];
      if (hostIds.length > 0) {
        await this.sessionHosts.save(
          hostIds.map((userId) => this.sessionHosts.create({ sessionId: session.id, userId })),
        );
      }
    }
    return session;
  }

  // Same 'member role can look but not touch' rule as
  // GroupsService.assertCanManage and InvitesService.assertCanInvite, with
  // one addition: the proposal's own creator can always manage it too, not
  // just group owners/admins — you don't need to be promoted to admin just
  // to un-confirm your own proposed game night.
  private async assertCanManageProposal(
    proposal: PlaySessionProposal,
    requestingUserId: string,
  ): Promise<void> {
    if (!(await this.canManageProposal(proposal, requestingUserId))) {
      throw new ForbiddenException(
        'Only the proposal creator or a group owner/admin can do this',
      );
    }
  }

  private async canManageProposal(
    proposal: PlaySessionProposal,
    requestingUserId: string,
  ): Promise<boolean> {
    if (proposal.createdBy === requestingUserId) return true;

    const membership = await this.members.findOneBy({
      groupId: proposal.groupId,
      userId: requestingUserId,
    });
    return membership?.role === 'owner' || membership?.role === 'admin';
  }
}
