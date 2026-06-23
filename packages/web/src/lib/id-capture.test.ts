import { describe, it, expect } from 'vitest';
import { idCaptureSteps } from './id-capture';

describe('idCaptureSteps', () => {
  it('returns front + back for a Ghana Card', () => {
    const steps = idCaptureSteps('ghana_card');
    expect(steps.map((s) => s.side)).toEqual(['front', 'back']);
    expect(steps[0]!.title).toBe('Front of Ghana Card');
    expect(steps[1]!.title).toBe('Back of Ghana Card');
  });

  it('returns a single step for a passport', () => {
    const steps = idCaptureSteps('passport');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.side).toBe('single');
  });

  it('returns a single step when the type is undefined', () => {
    expect(idCaptureSteps(undefined).map((s) => s.side)).toEqual(['single']);
  });
});
