// "HH:mm" (24h) of an ISO timestamp in the viewer's local time — the shape
// the API's rsvp DTO expects back and the RSVP inputs are keyed in.
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "Sat 30 Aug, 18:00 – 23:00" — used for the stored/confirmed window shown
// while confirming and after finalizing.
export function formatWindowRange(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '';
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const from = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const to = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${from} – ${to}`;
}
