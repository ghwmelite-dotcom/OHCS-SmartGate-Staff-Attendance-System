import { describe, it, expect } from 'vitest';
import { selectFanoutReceivers } from './notifier';

describe('selectFanoutReceivers', () => {
  it('excludes the host/primary', () => {
    expect(selectFanoutReceivers([{ officer_id: 'a' }, { officer_id: 'b' }], 'a')).toEqual(['b']);
  });
  it('dedupes officer ids', () => {
    expect(selectFanoutReceivers([{ officer_id: 'b' }, { officer_id: 'b' }, { officer_id: 'c' }], 'a')).toEqual(['b', 'c']);
  });
  it('returns empty when only the host is a receiver', () => {
    expect(selectFanoutReceivers([{ officer_id: 'a' }], 'a')).toEqual([]);
  });
});
