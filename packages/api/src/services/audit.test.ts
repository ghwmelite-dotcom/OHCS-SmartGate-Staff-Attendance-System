import { describe, it, expect } from 'vitest';
import { diffRecords } from './audit';

describe('diffRecords', () => {
  it('returns only changed fields', () => {
    expect(diffRecords({ name: 'A', role: 'staff' }, { name: 'A', role: 'admin' }))
      .toEqual({ role: { from: 'staff', to: 'admin' } });
  });

  it('respects an explicit field list', () => {
    expect(Object.keys(diffRecords({ a: 1, b: 2 }, { a: 9, b: 9 }, ['a']))).toEqual(['a']);
  });

  it('redacts secret-named fields on both sides', () => {
    expect(diffRecords({ reception_override_pin: '1111' }, { reception_override_pin: '2222' }).reception_override_pin)
      .toEqual({ from: '[redacted]', to: '[redacted]' });
  });

  it('treats null and undefined as equal (no spurious change)', () => {
    expect(diffRecords({ grade: null }, { grade: undefined })).toEqual({});
  });

  it('detects a value appearing where there was none', () => {
    expect(diffRecords({ grade: null }, { grade: 'Director' }))
      .toEqual({ grade: { from: null, to: 'Director' } });
  });
});
