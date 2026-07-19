import { describe, it, expect } from 'vitest';
import { matchesOfficerName } from './officer-search';

const OSBORN = 'Osborn Manuel Davies Kwesi Hodges';

describe('matchesOfficerName', () => {
  it('matches plain substring (existing behaviour)', () => {
    expect(matchesOfficerName(OSBORN, 'hodges')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'Hodges')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'manuel')).toBe(true);
  });

  it('matches word fragments in any order', () => {
    expect(matchesOfficerName(OSBORN, 'osborn hodges')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'hodges osborn')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'osb hod')).toBe(true);
  });

  it('matches initials, with or without punctuation/spaces', () => {
    expect(matchesOfficerName(OSBORN, 'mdk')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'M.D.K')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'm d k')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'omdk')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'osborn mdk')).toBe(true);
    expect(matchesOfficerName(OSBORN, 'osborn m.d.k')).toBe(true);
  });

  it('rejects non-matches', () => {
    expect(matchesOfficerName(OSBORN, 'mensah')).toBe(false);
    expect(matchesOfficerName(OSBORN, 'osborn mensah')).toBe(false);
    expect(matchesOfficerName(OSBORN, 'xyz')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(matchesOfficerName(OSBORN, '')).toBe(false);
    expect(matchesOfficerName('', 'hodges')).toBe(false);
    expect(matchesOfficerName(OSBORN, '   ')).toBe(false);
    // single-letter initials query is noise — not an initials match,
    // but still matches as a substring here
    expect(matchesOfficerName(OSBORN, 'z')).toBe(false);
    expect(matchesOfficerName(OSBORN, 'o')).toBe(true);
  });
});
