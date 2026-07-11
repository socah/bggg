import { randomBytes, createHash } from 'crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { CalendarFeedToken } from './calendar-feed-token.entity';
import { buildIcsFeed, CalendarEvent } from './build-ics';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';

// No signal for how long a session ran beyond the trimmed window a
// proposal stored (Decision D) — used as a fallback only for sessions with
// no proposal behind them (or, in principle, a proposal missing its
// confirmedEnd), so the calendar event still has SOME duration rather than
// a zero-length block.
const DEFAULT_SESSION_DURATION_MS = 3 * 60 * 60 * 1000;

@Injectable()
export class CalendarService {
  // Plain NestJS Logger, same as AuditService — routes through Pino once
  // main.ts is wired to it. No change needed here if/when that happens.
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @InjectRepository(CalendarFeedToken)
    private readonly feedTokens: Repository<CalendarFeedToken>,
    @InjectRepository(PlaySession)
    private readonly sessions: Repository<PlaySession>,
    @InjectRepository(PlaySessionProposal)
    private readonly proposals: Repository<PlaySessionProposal>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    @InjectRepository(Group)
    private readonly groups: Repository<Group>,
  ) {}

  // POST /calendar/token — issues (or replaces) this user's feed token. The
  // raw value is returned exactly once, here, and never stored — only its
  // hash is (Decision C, same shape as InvitesService.createInvite).
  async issueFeedToken(userId: string): Promise<{ feedUrl: string }> {
    const rawToken = randomBytes(32).toString('base64url');

    // userId is UNIQUE on this table — this is a REPLACE, not an
    // add-another. Deleting first means an old, leaked token stops working
    // the moment a new one is issued, which is the only revocation path
    // this design has (see the entity's comment).
    await this.feedTokens.delete({ userId });
    await this.feedTokens.save(
      this.feedTokens.create({ tokenHash: this.hashToken(rawToken), userId }),
    );

    const baseUrl = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
    return { feedUrl: `${baseUrl}/calendar/me.ics?token=${rawToken}` };
  }

  // GET /calendar/me.ics?token=... — deliberately reachable with NO
  // AuthGuard (Decision C). requestIp is logged for abuse visibility, never
  // used to make an access decision — the token is the only credential
  // that matters here.
  async getFeed(rawToken: string, requestIp: string): Promise<string> {
    const feedToken = await this.feedTokens.findOneBy({
      tokenHash: this.hashToken(rawToken),
    });

    if (!feedToken) {
      // A structured log line, not an audit_log row (Decision C) — this
      // endpoint gets hit far too often for a routine miss to belong in
      // the security-event table, but it still needs to be visible
      // somewhere once log aggregation (5_loki) exists.
      this.logger.warn({ msg: 'calendar_feed_token_invalid', ip: requestIp });
      throw new UnauthorizedException('Invalid or expired feed token');
    }

    this.logger.log({
      msg: 'calendar_feed_accessed',
      userId: feedToken.userId,
      ip: requestIp,
    });

    const events = await this.buildEventsFor(feedToken.userId);
    return buildIcsFeed(events);
  }

  private async buildEventsFor(userId: string): Promise<CalendarEvent[]> {
    const memberships = await this.members.findBy({ userId });
    if (memberships.length === 0) return [];

    const groupIds = memberships.map((m) => m.groupId);
    const groupNamesById = new Map(
      (await this.groups.findBy({ id: In(groupIds) })).map((g) => [g.id, g.name]),
    );

    // Only upcoming sessions — this feed is for "what's coming up," not a
    // history log. Every play_sessions row that exists at all was created
    // by SchedulingService.finalize (there's no other way to create one
    // yet), so no separate "is this real" filter is needed beyond the date.
    const upcomingSessions = await this.sessions.findBy({
      groupId: In(groupIds),
      playedAt: MoreThanOrEqual(new Date()),
    });

    return Promise.all(
      upcomingSessions.map(async (session) => ({
        // Stable across every refresh — the session's own id, never
        // regenerated — so a calendar app updates the existing event on
        // resync instead of creating a duplicate (see the worked example's
        // UID note in notes/3_scheduling.md).
        uid: `session-${session.id}@boardgame-platform`,
        summary: session.notes
          ? `${groupNamesById.get(session.groupId) ?? 'Game night'} — ${session.notes}`
          : (groupNamesById.get(session.groupId) ?? 'Game night'),
        start: session.playedAt,
        end: await this.resolveSessionEnd(session),
      })),
    );
  }

  private async resolveSessionEnd(session: PlaySession): Promise<Date> {
    if (session.proposalId) {
      const proposal = await this.proposals.findOneBy({ id: session.proposalId });
      if (proposal?.confirmedEnd) return proposal.confirmedEnd;
    }
    return new Date(session.playedAt.getTime() + DEFAULT_SESSION_DURATION_MS);
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
