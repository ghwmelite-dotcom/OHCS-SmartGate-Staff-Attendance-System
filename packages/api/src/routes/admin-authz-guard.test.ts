/**
 * AUTHZ REGRESSION GUARD — coarse source-scan safety net.
 *
 * This is a HEURISTIC test, NOT a substitute for code review. It reads route
 * source files with node:fs at test time (no app boot) and asserts that every
 * mutation/admin route registration sits in a handler that performs SOME role
 * check. Its job is narrow: fail CI the moment a future edit adds an
 * admin/mutation route WITHOUT a guard — locking in the audit Batch-1 fixes.
 *
 * What counts as a "guard" (any one of these idioms in the handler body):
 *   - requireRole(            — shared lib/require-role helper
 *   - requireSuperadmin(      — local boolean helpers (users.ts, bulk-import.ts,
 *                               admin-directorates.ts)
 *   - requireAdmin(           — local boolean helper (attendance.ts)
 *   - session.role            — inline comparison (admin-settings.ts,
 *                               admin-eval-assistant.ts, visitors.ts DELETE)
 *
 * Because it's a string scan it can't understand control flow — a route that
 * merely MENTIONS one of these tokens would pass. That's an accepted trade-off:
 * the goal is to catch the "forgot the guard entirely" mistake, which the audit
 * found, not to prove the guard is correct. Real authorization correctness is a
 * review concern.
 *
 * ALLOWLIST: routes that are intentionally unguarded by ROLE because they are
 * SELF-SCOPED (operate only on the calling user's own rows via session.userId).
 * Each entry is justified below. Adding a NEW unguarded route fails this test;
 * removing an allowlisted one also flags (so the list stays honest).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

// Files to scan: every admin-*.ts plus the explicit list of mutation-bearing routers.
function filesToScan(): string[] {
  const adminFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.startsWith('admin-') && f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const extra = [
    'visitors.ts',
    'visits.ts',
    'officers.ts',
    'photos.ts',
    'users.ts',
    'attendance.ts',
    'bulk-import.ts',
  ];
  return [...new Set([...adminFiles, ...extra])].sort();
}

// Recognised guard idioms (see header). Matched within a single handler body.
const GUARD_PATTERNS = [
  /requireRole\s*\(/,
  /requireSuperadmin\s*\(/,
  /requireAdmin\s*\(/,
  /session\.role\b/,
];

interface FoundRoute {
  file: string;
  method: string;
  path: string;
  lineIndex: number; // 0-based line where the registration starts
}

// Identify the router variable(s) in a file — the `const xRoutes = new Hono<...>()`
// declarations. Only `<routerVar>.<method>(` calls count as route registrations,
// which avoids false positives from c.get('session'), KV.get(...), req.query, etc.
function routerVars(src: string): string[] {
  const re = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*new\s+Hono\b/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]!);
  return names;
}

function findRoutes(file: string, src: string): FoundRoute[] {
  const vars = routerVars(src);
  if (vars.length === 0) return [];
  // <routerVar>.<method>( <stringLiteral> ...  on the SAME line.
  const escaped = vars.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const routeRe = new RegExp(
    `\\b(?:${escaped})\\.(get|post|put|patch|delete)\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`,
    'g',
  );
  const lines = src.split('\n');
  const routes: FoundRoute[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    routeRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(line)) !== null) {
      routes.push({ file, method: m[1]!.toUpperCase(), path: m[3]!, lineIndex: i });
    }
  }
  return routes;
}

// A handler body spans from its registration line up to (but not including) the
// next registration line in the same file, or EOF for the last route.
function handlerHasGuard(src: string, route: FoundRoute, nextLineIndex: number): boolean {
  const lines = src.split('\n');
  const body = lines.slice(route.lineIndex, nextLineIndex).join('\n');
  return GUARD_PATTERNS.some((re) => re.test(body));
}

function key(r: { file: string; method: string; path: string }): string {
  return `${r.file} ${r.method} ${r.path}`;
}

/**
 * Intentionally-unguarded-by-ROLE routes (self-scoped to the caller's own data
 * via session.userId). These are the ONLY legitimate exceptions. Note the auth
 * middleware still requires an authenticated session upstream — these routes are
 * not public, they just don't gate on role.
 */
const ALLOWLIST = new Set<string>([
  // Submit a leave request for YOURSELF — inserts with user_id = session.userId.
  // No role token in the handler, so it surfaces here; legitimately self-scoped.
  'attendance.ts POST /leave',
  // File an absence notice for YOURSELF — inserts with user_id = session.userId.
  // No role token in the handler; legitimately self-scoped.
  'attendance.ts POST /absence-notice',
  // Read YOUR OWN active absence notice — query scoped to session.userId.
  // No role token in the handler; legitimately self-scoped.
  'attendance.ts GET /absence-notice/today',
  // Set YOUR OWN host availability — resolves the caller's officer row via
  // session email→name and updates only that row. Officers can hold any role
  // (incl. plain staff), so a role gate would break legitimate self-service;
  // the row resolution is the authorization (spec: 2026-07-19-host-availability-design).
  'officers.ts PUT /me/availability',
  // NOTE: GET /leave is NOT listed — its handler branches on
  // `session.role === 'superadmin' | 'admin'` (admins see all, others see their
  // own), so the scanner already counts it as guarded. It is still effectively
  // self-scoped for non-admins via the user_id WHERE clause.
]);

describe('admin / mutation routes are role-guarded (source-scan safety net)', () => {
  const files = filesToScan();

  it('scans a non-trivial number of route files', () => {
    // Sanity: if globbing silently returns nothing the test would vacuously pass.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('every route has a guard idiom, except the explicit self-scoped allowlist', () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
      const routes = findRoutes(file, src);
      for (let i = 0; i < routes.length; i++) {
        const r = routes[i]!;
        const next = routes[i + 1]?.lineIndex ?? src.split('\n').length;
        if (!handlerHasGuard(src, r, next)) {
          unguarded.push(key(r));
        }
      }
    }

    const unguardedSet = new Set(unguarded);

    // (a) Any unguarded route NOT in the allowlist is a real finding.
    const newlyUnguarded = unguarded.filter((k) => !ALLOWLIST.has(k));
    expect(
      newlyUnguarded,
      `Unguarded admin/mutation route(s) found with no role check and not in the ` +
        `self-scoped allowlist. Add a requireRole/requireSuperadmin/requireAdmin/` +
        `session.role check, or (if genuinely self-scoped via session.userId) add ` +
        `to ALLOWLIST with justification:\n  - ${newlyUnguarded.join('\n  - ')}`,
    ).toEqual([]);

    // (b) Allowlist must stay honest: every allowlisted route must still exist
    // AND still be unguarded. A stale entry (route removed or since guarded)
    // should be cleaned up.
    const stale = [...ALLOWLIST].filter((k) => !unguardedSet.has(k));
    expect(
      stale,
      `Stale ALLOWLIST entr(ies): these routes are no longer present-and-unguarded ` +
        `(they were removed, renamed, or have since gained a guard). Remove them ` +
        `from ALLOWLIST:\n  - ${stale.join('\n  - ')}`,
    ).toEqual([]);
  });
});
