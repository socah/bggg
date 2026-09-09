import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';
import { Game } from '../games/game.entity';
import { GroupMember } from '../groups/group-member.entity';
import { GroupsService } from '../groups/groups.service';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { PlaySessionRsvp } from '../scheduling/play-session-rsvp.entity';
import { PlaySessionProposalGame } from '../scheduling/play-session-proposal-game.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { CreateGuestPlayerDto } from './dto/create-guest-player.dto';
import { CreatePlayDto } from './dto/create-play.dto';
import { LinkGuestPlayerDto } from './dto/link-guest-player.dto';
import { GuestPlayer } from './guest-player.entity';
import { PlayResult } from './play-result.entity';
import { PlaySessionPlayer } from './play-session-player.entity';
import { UpdatePlayDto } from './dto/update-play.dto';

export function rankMatchingSessions(
  sessions: PlaySession[],
  rsvps: PlaySessionRsvp[],
  suggestedGames: PlaySessionProposalGame[],
  playerIds: Set<string>,
  gameId: number,
): PlaySession[] {
  const overlap = (candidate: PlaySession) => candidate.proposalId
    ? rsvps.filter((rsvp) => rsvp.proposalId === candidate.proposalId && rsvp.status !== 'no' && playerIds.has(rsvp.userId)).length
    : 0;
  const suggested = (candidate: PlaySession) => candidate.proposalId
    ? Number(suggestedGames.some((row) => row.proposalId === candidate.proposalId && row.gameId === gameId))
    : 0;
  return [...sessions].sort((a, b) => overlap(b) - overlap(a) || suggested(b) - suggested(a) || a.playedAt.getTime() - b.playedAt.getTime());
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(GuestPlayer) private readonly guests: Repository<GuestPlayer>,
    @InjectRepository(PlaySession) private readonly sessions: Repository<PlaySession>,
    @InjectRepository(PlaySessionProposal) private readonly proposals: Repository<PlaySessionProposal>,
    @InjectRepository(PlaySessionRsvp) private readonly rsvps: Repository<PlaySessionRsvp>,
    @InjectRepository(PlaySessionProposalGame) private readonly proposalGames: Repository<PlaySessionProposalGame>,
    private readonly groupsService: GroupsService,
    private readonly dataSource: DataSource,
  ) {}

  async listPlayers(groupId: string, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const [members, guests, membership] = await Promise.all([
      this.groupsService.getMembers(groupId, userId),
      this.guests.find({ where: { groupId }, order: { name: 'ASC' } }),
      this.members.findOneBy({ groupId, userId }),
    ]);
    return {
      members,
      guests,
      canManageGuests: membership?.role === 'owner' || membership?.role === 'admin',
    };
  }

  async createGuest(groupId: string, dto: CreateGuestPlayerDto, userId: string): Promise<GuestPlayer> {
    await this.groupsService.findOne(groupId, userId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Player name cannot be empty');
    const duplicate = await this.guests
      .createQueryBuilder('guest')
      .where('guest.group_id = :groupId', { groupId })
      .andWhere('LOWER(guest.name) = LOWER(:name)', { name })
      .andWhere('guest.linked_user_id IS NULL')
      .getOne();
    if (duplicate) return duplicate;
    return this.guests.save(this.guests.create({ groupId, name, createdBy: userId, linkedUserId: null }));
  }

  async linkGuest(groupId: string, guestId: string, dto: LinkGuestPlayerDto, userId: string): Promise<GuestPlayer> {
    await this.groupsService.findOne(groupId, userId);
    const manager = await this.members.findOneBy({ groupId, userId });
    if (manager?.role !== 'owner' && manager?.role !== 'admin') {
      throw new ForbiddenException('Only group owners and admins can link guest players');
    }
    await this.groupsService.assertMember(groupId, dto.userId);

    return this.dataSource.transaction(async (entityManager) => {
      const guestRepo = entityManager.getRepository(GuestPlayer);
      const guest = await guestRepo.findOneBy({ id: guestId, groupId });
      if (!guest) throw new NotFoundException('Guest player not found');

      const playerRepo = entityManager.getRepository(PlaySessionPlayer);
      const resultRepo = entityManager.getRepository(PlayResult);
      const guestPlayers = await playerRepo.findBy({ guestPlayerId: guest.id });
      for (const guestPlayer of guestPlayers) {
        const accountPlayer = await playerRepo.findOneBy({ sessionId: guestPlayer.sessionId, userId: dto.userId });
        if (!accountPlayer) {
          guestPlayer.userId = dto.userId;
          guestPlayer.guestPlayerId = null;
          await playerRepo.save(guestPlayer);
          continue;
        }

        const guestResults = await resultRepo.findBy({ sessionPlayerId: guestPlayer.id });
        for (const guestResult of guestResults) {
          const accountResult = await resultRepo.findOneBy({
            playId: guestResult.playId,
            sessionPlayerId: accountPlayer.id,
          });
          if (accountResult) {
            accountResult.isWinner = accountResult.isWinner || guestResult.isWinner;
            accountResult.score ||= guestResult.score;
            await resultRepo.save(accountResult);
            await resultRepo.remove(guestResult);
          } else {
            guestResult.sessionPlayerId = accountPlayer.id;
            await resultRepo.save(guestResult);
          }
        }
        await playerRepo.remove(guestPlayer);
      }

      guest.linkedUserId = dto.userId;
      return guestRepo.save(guest);
    });
  }

  async createPlay(groupId: string, dto: CreatePlayDto, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const game = await this.games.findOneBy({ id: dto.gameId });
    if (!game) throw new NotFoundException('Game not found');

    const identities = dto.players.map((player) => {
      if (!!player.userId === !!player.guestPlayerId) {
        throw new BadRequestException('Each player must identify exactly one member or guest');
      }
      return player.userId ? `user:${player.userId}` : `guest:${player.guestPlayerId}`;
    });
    if (new Set(identities).size !== identities.length) {
      throw new BadRequestException('A player can only be included once');
    }

    const userIds = dto.players.flatMap((player) => player.userId ? [player.userId] : []);
    const guestIds = dto.players.flatMap((player) => player.guestPlayerId ? [player.guestPlayerId] : []);
    const [memberRows, guestRows] = await Promise.all([
      userIds.length ? this.members.findBy({ groupId, userId: In(userIds) }) : [],
      guestIds.length ? this.guests.findBy({ groupId, id: In(guestIds) }) : [],
    ]);
    if (memberRows.length !== new Set(userIds).size) throw new BadRequestException('Every account player must belong to the group');
    if (guestRows.length !== new Set(guestIds).size) throw new BadRequestException('Every guest player must belong to the group');
    const guestById = new Map(guestRows.map((guest) => [guest.id, guest]));

    let proposal: PlaySessionProposal | null = null;
    if (dto.proposalId) {
      proposal = await this.proposals.findOneBy({ id: dto.proposalId });
      if (!proposal || proposal.groupId !== groupId || proposal.status !== 'confirmed') {
        throw new BadRequestException('The proposal must be a confirmed proposal in this group');
      }
    }

    const start = new Date(`${dto.playedDate}T00:00:00.000Z`);
    const end = new Date(`${dto.playedDate}T23:59:59.999Z`);
    return this.dataSource.transaction(async (entityManager) => {
      const sessionRepo = entityManager.getRepository(PlaySession);
      let session = proposal
        ? await sessionRepo.findOneBy({ proposalId: proposal.id })
        : null;
      const candidates = session ? [] : await sessionRepo.find({
        where: { groupId, playedAt: Between(start, end) },
        order: { playedAt: 'ASC' },
      });
      if (!session && candidates.length > 0) {
        const proposalIds = candidates.flatMap((candidate) => candidate.proposalId ? [candidate.proposalId] : []);
        const [candidateRsvps, candidateGames] = await Promise.all([
          proposalIds.length ? this.rsvps.findBy({ proposalId: In(proposalIds) }) : [],
          proposalIds.length ? this.proposalGames.findBy({ proposalId: In(proposalIds) }) : [],
        ]);
        const actualUserIds = new Set([
          ...userIds,
          ...guestRows.flatMap((guest) => guest.linkedUserId ? [guest.linkedUserId] : []),
        ]);
        session = rankMatchingSessions(candidates, candidateRsvps, candidateGames, actualUserIds, dto.gameId)[0];
      }
      session ??= await sessionRepo.save(sessionRepo.create({
        groupId,
        playedAt: start,
        notes: null,
        proposalId: proposal?.id ?? null,
      }));

      const participantRepo = entityManager.getRepository(PlaySessionPlayer);
      const participantByIdentity = new Map<string, PlaySessionPlayer>();
      for (const input of dto.players) {
        const linkedUserId = input.guestPlayerId ? guestById.get(input.guestPlayerId)?.linkedUserId : null;
        const resolvedUserId = input.userId ?? linkedUserId ?? null;
        const identity = resolvedUserId ? `user:${resolvedUserId}` : `guest:${input.guestPlayerId}`;
        let participant = resolvedUserId
          ? await participantRepo.findOneBy({ sessionId: session.id, userId: resolvedUserId })
          : await participantRepo.findOneBy({ sessionId: session.id, guestPlayerId: input.guestPlayerId! });
        participant ??= await participantRepo.save(participantRepo.create({
          sessionId: session.id,
          userId: resolvedUserId,
          guestPlayerId: resolvedUserId ? null : input.guestPlayerId!,
        }));
        participantByIdentity.set(identity, participant);
      }

      const playRepo = entityManager.getRepository(PlaySessionGame);
      const play = await playRepo.save(playRepo.create({
        sessionId: session.id,
        gameId: dto.gameId,
        status: dto.status ?? 'finished',
        durationMinutes: dto.durationMinutes ?? null,
        notes: dto.notes?.trim() || null,
        loggedBy: userId,
      }));

      const resultRepo = entityManager.getRepository(PlayResult);
      const results: PlayResult[] = [];
      for (const input of dto.players) {
        const linkedUserId = input.guestPlayerId ? guestById.get(input.guestPlayerId)?.linkedUserId : null;
        const identity = input.userId || linkedUserId
          ? `user:${input.userId ?? linkedUserId}`
          : `guest:${input.guestPlayerId}`;
        const participant = participantByIdentity.get(identity)!;
        const existing = results.find((result) => result.sessionPlayerId === participant.id);
        if (existing) {
          existing.isWinner ||= input.isWinner ?? false;
          existing.score ||= input.score?.trim() || null;
          continue;
        }
        results.push(resultRepo.create({
          playId: play.id,
          sessionPlayerId: participant.id,
          isWinner: input.isWinner ?? false,
          score: input.score?.trim() || null,
        }));
      }
      await resultRepo.save(results);
      return { ...play, sessionId: session.id, game, results };
    });
  }

  async getPlay(groupId: string, playId: string, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const play = await this.dataSource.getRepository(PlaySessionGame).findOneBy({ id: playId });
    if (!play) throw new NotFoundException('Play not found');
    const session = await this.sessions.findOneBy({ id: play.sessionId, groupId });
    if (!session) throw new NotFoundException('Play not found');
    const results = await this.dataSource.getRepository(PlayResult).findBy({ playId });
    const participants = results.length
      ? await this.dataSource.getRepository(PlaySessionPlayer).findBy({ id: In(results.map((result) => result.sessionPlayerId)) })
      : [];
    const resultByPlayer = new Map(results.map((result) => [result.sessionPlayerId, result]));
    return {
      ...play,
      playedDate: session.playedAt.toISOString().slice(0, 10),
      players: participants.map((participant) => ({
        userId: participant.userId,
        guestPlayerId: participant.guestPlayerId,
        isWinner: resultByPlayer.get(participant.id)?.isWinner ?? false,
        score: resultByPlayer.get(participant.id)?.score ?? null,
      })),
    };
  }

  async updatePlay(groupId: string, playId: string, dto: UpdatePlayDto, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const play = await this.dataSource.getRepository(PlaySessionGame).findOneBy({ id: playId });
    if (!play) throw new NotFoundException('Play not found');
    const session = await this.sessions.findOneBy({ id: play.sessionId, groupId });
    if (!session) throw new NotFoundException('Play not found');
    const membership = await this.members.findOneBy({ groupId, userId });
    if (play.loggedBy !== userId && membership?.role !== 'owner' && membership?.role !== 'admin') {
      throw new ForbiddenException('Only the logger or a group manager can edit this play');
    }

    const identities = dto.players.map((player) => {
      if (!!player.userId === !!player.guestPlayerId) throw new BadRequestException('Each player must identify exactly one member or guest');
      return player.userId ? `user:${player.userId}` : `guest:${player.guestPlayerId}`;
    });
    if (new Set(identities).size !== identities.length) throw new BadRequestException('A player can only be included once');
    const userIds = dto.players.flatMap((player) => player.userId ? [player.userId] : []);
    const guestIds = dto.players.flatMap((player) => player.guestPlayerId ? [player.guestPlayerId] : []);
    const [memberRows, guestRows] = await Promise.all([
      userIds.length ? this.members.findBy({ groupId, userId: In(userIds) }) : [],
      guestIds.length ? this.guests.findBy({ groupId, id: In(guestIds) }) : [],
    ]);
    if (memberRows.length !== new Set(userIds).size || guestRows.length !== new Set(guestIds).size) {
      throw new BadRequestException('Every player must belong to the group roster');
    }
    const guestById = new Map(guestRows.map((guest) => [guest.id, guest]));

    return this.dataSource.transaction(async (entityManager) => {
      const participantRepo = entityManager.getRepository(PlaySessionPlayer);
      const resultRepo = entityManager.getRepository(PlayResult);
      const results: PlayResult[] = [];
      for (const input of dto.players) {
        const linkedUserId = input.guestPlayerId ? guestById.get(input.guestPlayerId)?.linkedUserId : null;
        const resolvedUserId = input.userId ?? linkedUserId ?? null;
        let participant = resolvedUserId
          ? await participantRepo.findOneBy({ sessionId: session.id, userId: resolvedUserId })
          : await participantRepo.findOneBy({ sessionId: session.id, guestPlayerId: input.guestPlayerId! });
        participant ??= await participantRepo.save(participantRepo.create({ sessionId: session.id, userId: resolvedUserId, guestPlayerId: resolvedUserId ? null : input.guestPlayerId! }));
        const existing = results.find((result) => result.sessionPlayerId === participant.id);
        if (existing) {
          existing.isWinner ||= input.isWinner ?? false;
          existing.score ||= input.score?.trim() || null;
        } else {
          results.push(resultRepo.create({ playId, sessionPlayerId: participant.id, isWinner: input.isWinner ?? false, score: input.score?.trim() || null }));
        }
      }
      await resultRepo.delete({ playId });
      await resultRepo.save(results);
      play.status = dto.status ?? play.status;
      if (dto.durationMinutes !== undefined) play.durationMinutes = dto.durationMinutes;
      if (dto.notes !== undefined) play.notes = dto.notes?.trim() || null;
      const saved = await entityManager.getRepository(PlaySessionGame).save(play);
      return { ...saved, sessionId: session.id, results };
    });
  }
}
