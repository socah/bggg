import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
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
import { UploadsService } from '../uploads/uploads.service';
import { Place } from '../scheduling/place.entity';
import { PlaceVisibility } from '../scheduling/place-visibility.entity';
import { UpdateSessionPlaceDto } from './dto/update-session-place.dto';
import type { PlayPlayersQueryDto } from './dto/play-players-query.dto';
import { PlayUserNote } from './play-user-note.entity';
import type { UpdatePlayNoteDto } from './dto/update-play-note.dto';

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
    @InjectRepository(Place) private readonly places: Repository<Place>,
    @InjectRepository(PlaceVisibility) private readonly placeVisibility: Repository<PlaceVisibility>,
    private readonly groupsService: GroupsService,
    private readonly dataSource: DataSource,
    private readonly uploadsService: UploadsService,
  ) {}

  async listPlayers(groupId: string, userId: string, query: PlayPlayersQueryDto = {}) {
    await this.groupsService.findOne(groupId, userId);
    const [members, guests, membership, session] = await Promise.all([
      this.groupsService.getMembers(groupId, userId),
      this.guests.find({ where: { groupId, archivedAt: IsNull() }, order: { name: 'ASC' } }),
      this.members.findOneBy({ groupId, userId }),
      query.playedDate ? this.findSessionForDate(groupId, query.playedDate, query.proposalId) : null,
    ]);
    const sessionPlayers = session
      ? await this.dataSource.getRepository(PlaySessionPlayer).findBy({ sessionId: session.id })
      : [];
    return {
      members,
      guests,
      canManageGuests: membership?.role === 'owner' || membership?.role === 'admin',
      sessionId: session?.id ?? null,
      sessionPlayerIds: sessionPlayers.map((player) => player.userId
        ? `user:${player.userId}`
        : `guest:${player.guestPlayerId}`),
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
      .andWhere('guest.archived_at IS NULL')
      .getOne();
    if (duplicate) return duplicate;
    return this.guests.save(this.guests.create({ groupId, name, createdBy: userId, linkedUserId: null, archivedAt: null }));
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

  async removeGuest(groupId: string, guestId: string, userId: string): Promise<void> {
    await this.groupsService.findOne(groupId, userId);
    const manager = await this.members.findOneBy({ groupId, userId });
    if (manager?.role !== 'owner' && manager?.role !== 'admin') {
      throw new ForbiddenException('Only group owners and admins can remove guest players');
    }
    const guest = await this.guests.findOneBy({ id: guestId, groupId });
    if (!guest) throw new NotFoundException('Guest player not found');
    guest.archivedAt = new Date();
    await this.guests.save(guest);
  }

  async listPlays(groupId: string, userId: string) {
    const group = await this.groupsService.findOne(groupId, userId);
    const sessions = await this.sessions.find({ where: { groupId }, order: { playedAt: 'DESC' } });
    if (sessions.length === 0) return [];
    const plays = await this.dataSource.getRepository(PlaySessionGame).findBy({ sessionId: In(sessions.map((session) => session.id)) });
    const games = plays.length ? await this.games.findBy({ id: In([...new Set(plays.map((play) => play.gameId))]) }) : [];
    const sessionPlayers = await this.dataSource.getRepository(PlaySessionPlayer).findBy({ sessionId: In(sessions.map((session) => session.id)) });
    const results = plays.length
      ? await this.dataSource.getRepository(PlayResult).findBy({ playId: In(plays.map((play) => play.id)) })
      : [];
    const myNotes = plays.length
      ? await this.dataSource.getRepository(PlayUserNote).findBy({ playId: In(plays.map((play) => play.id)), userId })
      : [];
    const guestIds = sessionPlayers.flatMap((player) => player.guestPlayerId ? [player.guestPlayerId] : []);
    const [groupMembers, guestPlayers] = await Promise.all([
      this.groupsService.getMembers(groupId, userId),
      guestIds.length ? this.guests.findBy({ id: In(guestIds), groupId }) : [],
    ]);
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const gameById = new Map(games.map((game) => [game.id, game]));
    const placeIds = sessions.flatMap((session) => session.placeId ? [session.placeId] : []);
    const places = placeIds.length ? await this.places.findBy({ id: In(placeIds) }) : [];
    const placeById = new Map(places.map((place) => [place.id, place]));
    const memberById = new Map(groupMembers.map((member) => [member.id, member]));
    const guestById = new Map(guestPlayers.map((guest) => [guest.id, guest]));
    const participantById = new Map(sessionPlayers.map((player) => [player.id, player]));
    const myNoteByPlayId = new Map(myNotes.map((note) => [note.playId, note.notes]));
    const participantSummary = (player: PlaySessionPlayer) => {
      if (player.userId) {
        const member = memberById.get(player.userId);
        return { id: `user:${player.userId}`, name: member?.nickname || member?.displayName || member?.username || 'Unknown member' };
      }
      const guest = guestById.get(player.guestPlayerId!);
      return { id: `guest:${player.guestPlayerId}`, name: guest?.name || 'Guest player' };
    };
    return plays.map((play) => ({
      id: play.id,
      sessionId: play.sessionId,
      proposalId: sessionById.get(play.sessionId)!.proposalId,
      groupId,
      groupName: group.name,
      game: gameById.get(play.gameId)!,
      playedDate: sessionById.get(play.sessionId)!.playedAt.toISOString().slice(0, 10),
      status: play.status,
      durationMinutes: play.durationMinutes,
      notes: myNoteByPlayId.get(play.id) ?? null,
      canEdit: true,
      sessionPlace: sessionById.get(play.sessionId)!.placeId
        ? { id: sessionById.get(play.sessionId)!.placeId!, name: placeById.get(sessionById.get(play.sessionId)!.placeId!)?.name ?? 'Unknown place' }
        : null,
      sessionParticipants: sessionPlayers.filter((player) => player.sessionId === play.sessionId).map(participantSummary),
      playParticipants: results
        .filter((result) => result.playId === play.id)
        .flatMap((result) => {
          const participant = participantById.get(result.sessionPlayerId);
          return participant ? [{ ...participantSummary(participant), isWinner: result.isWinner }] : [];
        }),
    })).sort((a, b) => b.playedDate.localeCompare(a.playedDate));
  }

  async updateSessionPlace(groupId: string, sessionId: string, dto: UpdateSessionPlaceDto, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const session = await this.sessions.findOneBy({ id: sessionId, groupId });
    if (!session) throw new NotFoundException('Session not found');
    if (dto.placeId !== undefined && dto.name !== undefined) {
      throw new BadRequestException('Choose an existing place or enter a new one');
    }
    const membership = await this.members.findOneBy({ groupId, userId });
    const proposal = session.proposalId ? await this.proposals.findOneBy({ id: session.proposalId }) : null;
    const loggedPlay = await this.dataSource.getRepository(PlaySessionGame).findOneBy({ sessionId, loggedBy: userId });
    if (!['owner', 'admin'].includes(membership?.role ?? '') && proposal?.createdBy !== userId && !loggedPlay) {
      throw new ForbiddenException('Only a session organizer, logger, or group manager can set the place');
    }

    let place: Place | null = null;
    if (dto.name?.trim()) {
      place = await this.places.save(this.places.create({ name: dto.name.trim(), createdBy: userId }));
      const groupMembers = await this.members.findBy({ groupId });
      await this.placeVisibility.upsert(groupMembers.map((member) => ({ placeId: place!.id, userId: member.userId, hidden: false })), ['placeId', 'userId']);
    } else if (dto.placeId) {
      place = await this.places.findOneBy({ id: dto.placeId });
      if (!place) throw new NotFoundException('Place not found');
    }
    session.placeId = place?.id ?? null;
    await this.sessions.save(session);
    return { id: session.id, place: place ? { id: place.id, name: place.name } : null };
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
      // Serializes the get-or-create path for this group and day so two
      // simultaneous play logs cannot both decide that no session exists.
      await entityManager.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [groupId, dto.playedDate]);
      const sessionRepo = entityManager.getRepository(PlaySession);
      const candidates = await sessionRepo.find({
        where: { groupId, playedAt: Between(start, end) },
        order: { playedAt: 'ASC', id: 'ASC' },
      });
      let session = dto.sessionId
        ? candidates.find((candidate) => candidate.id === dto.sessionId) ?? null
        : proposal
          ? candidates.find((candidate) => candidate.proposalId === proposal.id) ?? null
          : null;
      if (dto.sessionId && !session) {
        throw new BadRequestException('The selected session must belong to this group and date');
      }
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
        notes: null,
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

  private async findSessionForDate(groupId: string, playedDate: string, proposalId?: string): Promise<PlaySession | null> {
    const start = new Date(`${playedDate}T00:00:00.000Z`);
    const end = new Date(`${playedDate}T23:59:59.999Z`);
    const candidates = await this.sessions.find({
      where: { groupId, playedAt: Between(start, end) },
      order: { playedAt: 'ASC', id: 'ASC' },
    });
    if (candidates.length === 0) return null;
    return (proposalId ? candidates.find((candidate) => candidate.proposalId === proposalId) : null)
      ?? candidates[0];
  }

  async getPlay(groupId: string, playId: string, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const play = await this.dataSource.getRepository(PlaySessionGame).findOneBy({ id: playId });
    if (!play) throw new NotFoundException('Play not found');
    const session = await this.sessions.findOneBy({ id: play.sessionId, groupId });
    if (!session) throw new NotFoundException('Play not found');
    const [results, notes, groupMembers] = await Promise.all([
      this.dataSource.getRepository(PlayResult).findBy({ playId }),
      this.dataSource.getRepository(PlayUserNote).findBy({ playId }),
      this.groupsService.getMembers(groupId, userId),
    ]);
    const participants = results.length
      ? await this.dataSource.getRepository(PlaySessionPlayer).findBy({ id: In(results.map((result) => result.sessionPlayerId)) })
      : [];
    const resultByPlayer = new Map(results.map((result) => [result.sessionPlayerId, result]));
    const memberById = new Map(groupMembers.map((member) => [member.id, member]));
    return {
      ...play,
      notes: notes.map((note) => {
        const member = memberById.get(note.userId);
        return {
          id: note.userId,
          userId: note.userId,
          notes: note.notes,
          username: member?.username ?? 'unknown-member',
          displayName: member?.displayName ?? 'Unknown member',
          nickname: member?.nickname ?? null,
          isCurrentUser: note.userId === userId,
        };
      }),
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
      await this.removeOrphanedSessionPlayers(entityManager, session.id);
      play.status = dto.status ?? play.status;
      if (dto.durationMinutes !== undefined) play.durationMinutes = dto.durationMinutes;
      const saved = await entityManager.getRepository(PlaySessionGame).save(play);
      return { ...saved, sessionId: session.id, results };
    });
  }

  async updatePlayNote(groupId: string, playId: string, dto: UpdatePlayNoteDto, userId: string) {
    await this.groupsService.findOne(groupId, userId);
    const play = await this.dataSource.getRepository(PlaySessionGame).findOneBy({ id: playId });
    if (!play) throw new NotFoundException('Play not found');
    const session = await this.sessions.findOneBy({ id: play.sessionId, groupId });
    if (!session) throw new NotFoundException('Play not found');

    const noteRepo = this.dataSource.getRepository(PlayUserNote);
    const notes = dto.notes?.trim() || null;
    if (!notes) {
      await noteRepo.delete({ playId, userId });
      return { userId, notes: null };
    }
    await noteRepo.upsert({ playId, userId, notes }, ['playId', 'userId']);
    return { userId, notes };
  }

  async removePlay(groupId: string, playId: string, userId: string): Promise<void> {
    await this.groupsService.findOne(groupId, userId);
    const playRepo = this.dataSource.getRepository(PlaySessionGame);
    const play = await playRepo.findOneBy({ id: playId });
    if (!play) throw new NotFoundException('Play not found');
    const session = await this.sessions.findOneBy({ id: play.sessionId, groupId });
    if (!session) throw new NotFoundException('Play not found');
    await this.uploadsService.deleteObjectsForPlay(playId);
    await this.dataSource.transaction(async (entityManager) => {
      await entityManager.getRepository(PlaySessionGame).remove(play);
      const remaining = await entityManager.getRepository(PlaySessionGame).countBy({ sessionId: session.id });
      if (remaining === 0 && !session.proposalId) {
        await entityManager.getRepository(PlaySession).remove(session);
      } else {
        await this.removeOrphanedSessionPlayers(entityManager, session.id);
      }
    });
  }

  private async removeOrphanedSessionPlayers(entityManager: EntityManager, sessionId: string): Promise<void> {
    const participantRepo = entityManager.getRepository(PlaySessionPlayer);
    const participants = await participantRepo.findBy({ sessionId });
    if (participants.length === 0) return;
    const results = await entityManager.getRepository(PlayResult).findBy({
      sessionPlayerId: In(participants.map((participant) => participant.id)),
    });
    const referencedIds = new Set(results.map((result) => result.sessionPlayerId));
    const orphaned = participants.filter((participant) => !referencedIds.has(participant.id));
    if (orphaned.length > 0) await participantRepo.remove(orphaned);
  }
}
