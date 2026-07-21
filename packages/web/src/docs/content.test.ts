import { describe, it, expect } from 'vitest';
import { DOC_SECTIONS, DOCS_LAST_UPDATED } from './content';

// Content hygiene guards — the docs page is only as good as its data.
describe('docs content', () => {
  it('has unique section ids', () => {
    const ids = DOC_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every section is complete and non-empty', () => {
    for (const s of DOC_SECTIONS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.tagline.length).toBeGreaterThan(0);
      expect(s.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.features.length).toBeGreaterThan(0);
    }
  });

  it('every feature has a valid status and a real summary', () => {
    for (const s of DOC_SECTIONS) {
      for (const f of s.features) {
        expect(['live', 'shadow', 'design']).toContain(f.status);
        expect(f.name.length).toBeGreaterThan(0);
        expect(f.summary.length).toBeGreaterThan(20);
      }
    }
  });

  it('feature names are unique within a section', () => {
    for (const s of DOC_SECTIONS) {
      const names = s.features.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('carries a last-updated date', () => {
    expect(DOCS_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
