// "HH:mm" (24h) of an ISO timestamp in UTC — the same convention the API
// uses to build window timestamps from HH:mm inputs (see apps/api
// resolve-window.ts combineDateAndTime). Rendering in any other zone would
// make re-saving prefilled hours silently shift the stored window.
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// "Sat 30 Aug, 18:00 – 23:00 (UTC)" — used for the stored/confirmed window.
// Times are UTC to match what members entered; the suffix says so.
export function formatWindowRange(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '';
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const from = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const to = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${day}, ${from} – ${to} (UTC)`;
}
