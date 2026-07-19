/** Extract a presence token from a scanned QR payload — accepts a raw UUID or
 *  the display URL (...?presence=<uuid>); anything else → null (keep scanning). */
export function parsePresenceToken(data: string): string | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const t = data.trim();
  if (UUID.test(t)) return t.toLowerCase();
  try {
    const p = new URL(t).searchParams.get('presence');
    return p && UUID.test(p) ? p.toLowerCase() : null;
  } catch { return null; }
}

// ---- Deep-link prefill ----
// The display QR encodes https://staff-attendance.ohcsghana.org/clock?presence=<token>;
// scanned with the phone's camera app it opens the PWA at that URL. The router
// stashes the token here (sessionStorage — survives the /login detour, dies
// with the tab) and ClockPage consumes it when the scan step is entered.

const DEEPLINK_KEY = 'ohcs.presence.deeplink';

/** Max age of a stashed token before it is treated as absent. Matches the
 *  server's replay heuristic (>3 min old ⇒ replay); older stashes are dropped
 *  so enforce mode still demands a fresh scan. */
export const PRESENCE_DEEPLINK_MAX_AGE_MS = 3 * 60_000;

export interface PresenceDeeplinkStash {
  token: string;
  /** epoch ms when the deep link was captured (drives captured_at). */
  at: number;
}

/** Stash a deep-link presence token for the next clock attempt. */
export function stashPresenceDeeplink(token: string, at: number = Date.now()): void {
  try {
    sessionStorage.setItem(DEEPLINK_KEY, JSON.stringify({ token, at }));
  } catch { /* storage unavailable (private mode) — non-fatal */ }
}

/** Read + validate the stash without consuming it. Null for missing, malformed
 *  (bad JSON / wrong shape / non-UUID token) or expired entries. */
export function readPresenceDeeplink(now: number = Date.now()): PresenceDeeplinkStash | null {
  try {
    const raw = sessionStorage.getItem(DEEPLINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PresenceDeeplinkStash> | null;
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.at !== 'number') return null;
    const token = parsePresenceToken(parsed.token);
    if (!token) return null;
    if (!Number.isFinite(parsed.at)) return null;
    if (now - parsed.at > PRESENCE_DEEPLINK_MAX_AGE_MS || parsed.at > now + 60_000) return null;
    return { token, at: parsed.at };
  } catch { return null; }
}

export function clearPresenceDeeplink(): void {
  try { sessionStorage.removeItem(DEEPLINK_KEY); } catch { /* ignore */ }
}

/** One-shot consume for the scan step: clears the stash and returns the token
 *  to use. A fresh in-app scan always wins over the stash — when `scanned` is
 *  set it is returned (re-stamped to now); otherwise the validated stash. */
export function consumePresenceDeeplink(scanned: string | null, now: number = Date.now()): PresenceDeeplinkStash | null {
  const stash = readPresenceDeeplink(now);
  clearPresenceDeeplink();
  if (scanned) return { token: scanned, at: now };
  return stash;
}
