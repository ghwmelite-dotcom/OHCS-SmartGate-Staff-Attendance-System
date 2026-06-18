import { describe, it, expect } from 'vitest';
import { suggestDirectorate, type DirectorateOption } from './directorate-routing';

const dirs: DirectorateOption[] = [
  { id: 'd_fa', name: 'Finance & Administration', abbreviation: 'F&A' },
  { id: 'd_reg', name: 'Confidential Registry', abbreviation: 'REGISTRY' },
];

describe('suggestDirectorate', () => {
  it('returns null for short/empty purpose', () => {
    expect(suggestDirectorate('', dirs)).toBeNull();
    expect(suggestDirectorate('hi', dirs)).toBeNull();
  });
  it('routes a budget/payment purpose to F&A', () => {
    expect(suggestDirectorate('here to make a payment', dirs)?.abbreviation).toBe('F&A');
  });
  it('routes a document-submission purpose to REGISTRY', () => {
    expect(suggestDirectorate('submit documents', dirs)?.abbreviation).toBe('REGISTRY');
  });
  it('returns null when no keyword matches', () => {
    expect(suggestDirectorate('just visiting a friend', dirs)).toBeNull();
  });
  it('returns null when the matched directorate is not in the list', () => {
    expect(suggestDirectorate('audit and risk review', dirs)).toBeNull();
  });
});
