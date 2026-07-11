import { buildIcsFeed, CalendarEvent } from './build-ics';

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'session-1@boardgame-platform',
  summary: 'Catan Night',
  start: new Date(Date.UTC(2026, 6, 19, 18, 0, 0)),
  end: new Date(Date.UTC(2026, 6, 19, 22, 0, 0)),
  ...overrides,
});

describe('buildIcsFeed', () => {
  it('wraps zero events in a still-valid VCALENDAR envelope', () => {
    const feed = buildIcsFeed([]);

    expect(feed).toContain('BEGIN:VCALENDAR');
    expect(feed).toContain('VERSION:2.0');
    expect(feed).toContain('END:VCALENDAR');
    expect(feed).not.toContain('BEGIN:VEVENT');
  });

  it('renders one event with the compact ICS datetime format and a stable UID', () => {
    const feed = buildIcsFeed([event()]);

    expect(feed).toContain('BEGIN:VEVENT');
    expect(feed).toContain('UID:session-1@boardgame-platform');
    // YYYYMMDDTHHMMSSZ — no dashes, no colons, no milliseconds.
    expect(feed).toContain('DTSTART:20260719T180000Z');
    expect(feed).toContain('DTEND:20260719T220000Z');
    expect(feed).toContain('SUMMARY:Catan Night');
    expect(feed).toContain('END:VEVENT');
  });

  it('renders every event when given more than one', () => {
    const feed = buildIcsFeed([
      event({ uid: 'session-1@boardgame-platform' }),
      event({ uid: 'session-2@boardgame-platform', summary: 'Chess Club' }),
    ]);

    expect(feed).toContain('UID:session-1@boardgame-platform');
    expect(feed).toContain('UID:session-2@boardgame-platform');
    expect(feed).toContain('SUMMARY:Chess Club');
  });

  it('escapes commas, semicolons, and backslashes reserved by the ICS format', () => {
    // Unescaped, a comma or semicolon here would corrupt the SUMMARY field
    // for every calendar client parsing this feed (RFC 5545 §3.3.11) — not
    // just render oddly, but break parsing of the surrounding VEVENT block.
    const feed = buildIcsFeed([event({ summary: 'Catan; Ticket to Ride, and C:\\Games' })]);

    expect(feed).toContain('SUMMARY:Catan\\; Ticket to Ride\\, and C:\\\\Games');
  });

  it('escapes newlines in the summary', () => {
    const feed = buildIcsFeed([event({ summary: 'Line one\nLine two' })]);

    expect(feed).toContain('SUMMARY:Line one\\nLine two');
    // The literal newline must not survive — ICS treats a raw newline as
    // ending the current property line, which would corrupt the block.
    expect(feed).not.toMatch(/SUMMARY:Line one\r?\nLine two/);
  });

  it('produces a stable UID regardless of when the feed is built', () => {
    // DTSTAMP is allowed to change between requests (it's "when this feed
    // was generated"), but UID must not — see the worked example's note on
    // why calendar clients rely on it for de-duplication.
    const first = buildIcsFeed([event()]);
    const second = buildIcsFeed([event()]);

    const extractUid = (feed: string) => feed.match(/UID:(.+)/)?.[1];
    expect(extractUid(first)).toBe(extractUid(second));
  });
});
