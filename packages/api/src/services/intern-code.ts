/** Intern login/identity code: OHCS-INT-YYYY-NNN (NNN zero-padded, year-scoped). */
export function formatInternCode(year: number, seq: number): string {
  return `OHCS-INT-${year}-${String(seq).padStart(3, '0')}`;
}

/** Pure helper: next sequence given the latest existing code for a year (or null). */
export function nextInternSeqFrom(latestCode: string | null, year: number): number {
  const prefix = `OHCS-INT-${year}-`;
  if (!latestCode || !latestCode.startsWith(prefix)) return 1;
  const n = parseInt(latestCode.slice(prefix.length), 10);
  return Number.isFinite(n) ? n + 1 : 1;
}

/**
 * Compute the next intern code for `year` by reading the highest existing code.
 * Zero-padding to 3 digits makes lexicographic ORDER BY == numeric order up to 999
 * codes/year (far above OHCS volume). The unique index on intern_code is the backstop.
 */
export async function nextInternCode(db: D1Database, year: number): Promise<string> {
  const prefix = `OHCS-INT-${year}-`;
  const row = await db
    .prepare(`SELECT intern_code FROM users WHERE intern_code LIKE ? ORDER BY intern_code DESC LIMIT 1`)
    .bind(`${prefix}%`)
    .first<{ intern_code: string }>();
  return formatInternCode(year, nextInternSeqFrom(row?.intern_code ?? null, year));
}
