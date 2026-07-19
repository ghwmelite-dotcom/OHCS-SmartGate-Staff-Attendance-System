/**
 * Smart officer-name matching for the host pickers (reception combobox + kiosk).
 *
 * Matches when ANY of these holds:
 *  1. Substring — "hodges" ⊂ "Osborn Manuel Davies Kwesi Hodges"
 *  2. Word fragments, any order — "osborn hodges": every query token appears
 *     inside some name word
 *  3. Initials — "mdk" / "o m d k" / "omdk": the collapsed query letters appear
 *     in order inside the name's initials ("omdkh")
 *
 * Motivation: officers are imported with full legal names, but colleagues
 * search by short form, initials, or partial names.
 */
export function matchesOfficerName(name: string, query: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const n = normalize(name);
  const q = normalize(query);
  if (!n || !q) return false;

  // 1. Plain substring (existing behaviour)
  if (n.includes(q)) return true;

  const nameWords = n.split(' ');
  const queryTokens = q.split(' ');
  const initials = nameWords.map((w) => w[0]).join('');

  // 2. Every query token appears inside some name word (any order) — or, for
  //    ≥2-letter tokens, inside the initials string ("osborn mdk" style)
  const tokenOk = (t: string) =>
    nameWords.some((w) => w.includes(t)) || (t.length >= 2 && initials.includes(t));
  if (queryTokens.every(tokenOk)) return true;

  // 3. Whole-query initials subsequence — requires ≥2 letters to avoid noise
  const queryLetters = q.replace(/\s/g, '');
  if (queryLetters.length >= 2 && initials.includes(queryLetters)) return true;

  return false;
}
