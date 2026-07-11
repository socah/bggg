// Pure ICS text builder — isolated the same way overlap-window.ts and
// resolve-window.ts are, so the formatting rules (escaping, the compact
// datetime format, stable UIDs) are unit-testable without a database or
// HTTP request in the way. See notes/3_scheduling.md's worked example for
// the toy version this is based on.

export interface CalendarEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
}

function toIcsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// Escapes characters ICS reserves for its own syntax (RFC 5545 §3.3.11).
// Without this, a group name or session note containing a comma or
// semicolon would corrupt the surrounding VEVENT block for every calendar
// client trying to parse it — not just look wrong, actually fail to parse.
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

function toVEvent(event: CalendarEvent): string {
  return [
    'BEGIN:VEVENT',
    // Stable across every refresh — see CalendarService.buildEventsFor for
    // where this comes from (the session's own id, never regenerated).
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDateTime(new Date())}`,
    `DTSTART:${toIcsDateTime(event.start)}`,
    `DTEND:${toIcsDateTime(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    'END:VEVENT',
  ].join('\r\n');
}

export function buildIcsFeed(events: CalendarEvent[]): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//boardgame-platform//scheduling//EN',
      ...events.map(toVEvent),
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}
