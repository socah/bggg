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
import { GroupsService } from '../groups/groups.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { ProposeGameDto } from './dto/propose-game.dto';
import { computeOverlapWindow, NoOverlapError } from './overlap-window';
import { resolveAvailabilityWindow } from './resolve-window';

// One entry of GET /proposals/:id/games (and the games array inside
// GET /proposals/:id). proposalGameId is the join-row id the vote
// endpoints address; votedByMe lets the UI render the caller's own vote
// state without a second request.
export interface ProposalGameWithVotes {
  proposalGameId: string;
  game: { id: number; name: string };
  voteCount: number;
  votedByMe: boolean;
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
    // Own registration of GroupMember, same "each module registers its own
    // repository for a shared entity" pattern InvitesModule already uses —
    // see the comment in groups.module.ts.
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    // For "is this user even a member of this group" checks — reused
    // rather than reimplemented, same reasoning as ChatService injecting
    // GroupsService instead of querying GroupMember itself.
    private readonly groupsService: GroupsService,
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

    return this.rsvps.save(rsvp);
  }

  async setHost(
    proposalId: string,
    hostUserId: string,
    requestingUserId: string,
  ): Promise<PlaySessionProposal> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    const hostRsvp = await this.rsvps.findOneBy({
      proposalId,
      userId: hostUserId,
      status: 'yes',
    });
    if (!hostRsvp) {
      throw new BadRequestException('The host must have a yes RSVP on this proposal');
    }

    proposal.hostId = hostUserId;
    return this.proposals.save(proposal);
  }

  async clearHost(proposalId: string, requestingUserId: string): Promise<PlaySessionProposal> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    proposal.hostId = null;
    return this.proposals.save(proposal);
  }

  // POST /proposals/:id/request-confirmation — the 'collecting' ->
  // 'confirming' transition (Decision B, step 2). Computes and stores the
  // trimmed window; does NOT create a play_sessions row yet.
  async requestConfirmation(
    proposalId: string,
    requestingUserId: string,
  ): Promise<PlaySessionProposal> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    if (proposal.status !== 'collecting') {
      throw new ConflictException(`Cannot request confirmation from status '${proposal.status}'`);
    }

    const yesRsvps = await this.rsvps.findBy({ proposalId, status: 'yes' });
    const windows = yesRsvps
      .filter((r): r is PlaySessionRsvp & { availableStart: Date; availableEnd: Date } =>
        r.availableStart !== null && r.availableEnd !== null,
      )
      .map((r) => ({ userId: r.userId, start: r.availableStart, end: r.availableEnd }));

    let window: { start: Date; end: Date };
    try {
      window = computeOverlapWindow(windows, proposal.hostId);
    } catch (err) {
      // NoOverlapError means "no valid session window exists yet" — a
      // client-fixable state (more RSVPs needed, or conflicting windows),
      // so it surfaces as 409, not a 500.
      if (err instanceof NoOverlapError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    proposal.status = 'confirming';
    proposal.confirmedStart = window.start;
    proposal.confirmedEnd = window.end;
    return this.proposals.save(proposal);
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
    return this.rsvps.save(rsvp);
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

    const session = await this.sessions.save(
      this.sessions.create({
        groupId: proposal.groupId,
        playedAt: proposal.confirmedStart,
        proposalId: proposal.id,
      }),
    );

    proposal.status = 'confirmed';
    await this.proposals.save(proposal);

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

    // Terminal state (see cancel()) — undo must not resurrect a cancelled
    // proposal.
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
        await this.sessions.remove(session);
      }
    }

    await this.rsvps.update({ proposalId: proposal.id }, { confirmed: false });

    proposal.status = 'collecting';
    proposal.confirmedStart = null;
    proposal.confirmedEnd = null;
    return this.proposals.save(proposal);
  }

  // POST /proposals/:id/cancel — terminal transition from collecting,
  // confirming, OR confirmed (game nights get called off after being finalized
  // too). Unlike undo there is no way back: a cancelled proposal stays that
  // way and a new proposal is created instead. If a play_sessions row exists
  // it is deleted BEFORE the status flip, same delete-before-flip ordering as
  // undo() — a cancelled-status proposal still owning a live session would be
  // exactly the inconsistency that ordering avoids.
  async cancel(proposalId: string, requestingUserId: string): Promise<PlaySessionProposal> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    if (proposal.status === 'cancelled') {
      throw new ConflictException('Proposal is already cancelled');
    }

    if (proposal.status === 'confirmed') {
      const session = await this.sessions.findOneBy({ proposalId: proposal.id });
      if (session) {
        await this.sessions.remove(session);
      }
    }

    proposal.status = 'cancelled';
    return this.proposals.save(proposal);
  }

  async removeProposal(proposalId: string, requestingUserId: string): Promise<void> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.assertCanManageProposal(proposal, requestingUserId);

    const session = await this.sessions.findOneBy({ proposalId });
    if (session) {
      await this.sessions.remove(session);
    }
    await this.proposals.remove(proposal);
  }

  async proposeGame(
    proposalId: string,
    dto: ProposeGameDto,
    requestingUserId: string,
  ): Promise<PlaySessionProposalGame> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    // UNIQUE (proposal_id, game_id) means a second "propose" of the same
    // game is a no-op, not an error — further interest is a vote, not a
    // duplicate proposal.
    const existing = await this.proposalGames.findOneBy({ proposalId, gameId: dto.gameId });
    if (existing) return existing;

    return this.proposalGames.save(
      this.proposalGames.create({
        proposalId,
        gameId: dto.gameId,
        proposedBy: requestingUserId,
      }),
    );
  }

  async voteForGame(proposalGameId: string, requestingUserId: string): Promise<void> {
    const proposalGame = await this.proposalGames.findOneBy({ id: proposalGameId });
    if (!proposalGame) throw new NotFoundException('Proposed game not found');

    const proposal = await this.findProposalOrThrow(proposalGame.proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    const existing = await this.gameVotes.findOneBy({ proposalGameId, userId: requestingUserId });
    if (existing) return;

    await this.gameVotes.save(this.gameVotes.create({ proposalGameId, userId: requestingUserId }));
  }

  async unvoteForGame(proposalGameId: string, requestingUserId: string): Promise<void> {
    const proposalGame = await this.proposalGames.findOneBy({ id: proposalGameId });
    if (!proposalGame) throw new NotFoundException('Proposed game not found');

    const proposal = await this.findProposalOrThrow(proposalGame.proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    await this.gameVotes.delete({ proposalGameId, userId: requestingUserId });
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
      proposalGames.map(async (proposalGame) => ({
        proposalGameId: proposalGame.id,
        game: {
          id: proposalGame.gameId,
          name: gameById.get(proposalGame.gameId)?.name ?? 'Unknown game',
        },
        voteCount: await this.gameVotes.countBy({ proposalGameId: proposalGame.id }),
        votedByMe: await this.gameVotes.existsBy({
          proposalGameId: proposalGame.id,
          userId: requestingUserId,
        }),
      })),
    );
    return rows.sort(
      (left, right) =>
        right.voteCount - left.voteCount ||
        left.game.name.localeCompare(right.game.name) ||
        left.proposalGameId.localeCompare(right.proposalGameId),
    );
  }

  async listProposals(groupId: string, requestingUserId: string): Promise<PlaySessionProposal[]> {
    await this.groupsService.findOne(groupId, requestingUserId);
    return this.proposals.find({ where: { groupId }, order: { createdAt: 'DESC' } });
  }

  async getProposal(
    proposalId: string,
    requestingUserId: string,
  ): Promise<{
    proposal: PlaySessionProposal;
    rsvps: PlaySessionRsvp[];
    games: ProposalGameWithVotes[];
    canManage: boolean;
  }> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    const rsvps = await this.rsvps.findBy({ proposalId });
    // Reuses listProposalGames' own vote-counting logic rather than
    // duplicating it — the redundant proposal/membership re-check inside it
    // is cheap at this project's scale and keeps this a one-line call
    // instead of extracting a shared private helper for one caller.
    const games = await this.listProposalGames(proposalId, requestingUserId);
    const canManage = await this.canManageProposal(proposal, requestingUserId);
    return { proposal, rsvps, games, canManage };
  }

  private async findProposalOrThrow(proposalId: string): Promise<PlaySessionProposal> {
    const proposal = await this.proposals.findOneBy({ id: proposalId });
    if (!proposal) throw new NotFoundException(`Proposal ${proposalId} not found`);
    return proposal;
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
