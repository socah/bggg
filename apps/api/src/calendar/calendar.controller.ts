import { Controller, Get, Post, Query, Req, Header, UseGuards, Request } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { AuthGuard } from '../auth/auth.guard';

interface AuthenticatedRequest {
  user: { sub: string };
}

// Only the field this controller actually reads — same "don't import the
// full Express Request type for one field" convention as
// groups.controller.ts's AuthenticatedRequest.
interface IcsRequest {
  ip?: string;
}

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  // POST /calendar/token → 200 OK with a fresh feed URL. Authenticated:
  // issuing YOUR OWN token still requires proving who you are the normal
  // way. It's only the .ics endpoint below that has to skip AuthGuard.
  @UseGuards(AuthGuard)
  @Post('token')
  issueToken(@Request() req: AuthenticatedRequest) {
    return this.calendarService.issueFeedToken(req.user.sub);
  }

  // GET /calendar/me.ics?token=... → text/calendar. Deliberately NOT
  // behind AuthGuard (Decision C) — this is the one endpoint in the whole
  // API a calendar app (Google Calendar, Apple Calendar) can actually call,
  // since neither can attach a JWT to a subscription URL.
  @Get('me.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  getFeed(@Query('token') token: string, @Req() req: IcsRequest) {
    return this.calendarService.getFeed(token, req.ip ?? 'unknown');
  }
}
