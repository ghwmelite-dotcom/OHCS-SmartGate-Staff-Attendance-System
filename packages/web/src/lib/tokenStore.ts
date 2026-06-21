// Bearer-token storage is retired — auth is a first-party HttpOnly cookie.
// `getToken` always returns null so the legacy `Authorization: Bearer` path is
// inert (and any stale token left in localStorage by a pre-cookie-migration login
// is ignored); `clearToken` still removes that stale key. There is no `setToken` —
// nothing may persist a token to localStorage (XSS-exfiltration risk).
const KEY = 'ohcs.token';

export function getToken(): string | null {
  return null;
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
