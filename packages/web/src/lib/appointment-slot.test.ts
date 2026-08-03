import { describe, it, expect } from 'vitest';
import { slotEndTime, formatProposedSlot } from './appointment-slot';

describe('slotEndTime', () => {
  it('adds the duration within the hour', () => {
    expect(slotEndTime('10:00', 30)).toBe('10:30');
  });

  it('rolls over the hour boundary', () => {
    expect(slotEndTime('10:45', 30)).toBe('11:15');
  });

  it('pads single-digit hours and minutes', () => {
    expect(slotEndTime('09:05', 15)).toBe('09:20');
  });
});

describe('formatProposedSlot', () => {
  it('renders a range when the duration is known', () => {
    expect(formatProposedSlot('2026-08-05', '10:00', 30)).toBe('Wed 5 Aug, 10:00–10:30');
  });

  it('renders just the start time without a duration', () => {
    expect(formatProposedSlot('2026-08-05', '10:00')).toBe('Wed 5 Aug, 10:00');
    expect(formatProposedSlot('2026-08-05', '10:00', null)).toBe('Wed 5 Aug, 10:00');
    expect(formatProposedSlot('2026-08-05', '10:00', 0)).toBe('Wed 5 Aug, 10:00');
  });
});
