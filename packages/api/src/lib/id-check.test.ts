import { describe, it, expect } from 'vitest';
import { parseModelVerdict } from './id-check';

describe('parseModelVerdict', () => {
  it('parses a clean document JSON', () => {
    const v = parseModelVerdict('{"is_document": true, "type": "ghana_card", "confidence": 0.92}');
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBe('ghana_card');
    expect(v.confidence).toBe(0.92);
  });
  it('maps is_document false to not_document', () => {
    const v = parseModelVerdict('{"is_document": false, "type": "none", "confidence": 0.8}');
    expect(v.verdict).toBe('not_document');
    expect(v.detected_type).toBe('none');
  });
  it('extracts JSON embedded in prose', () => {
    const v = parseModelVerdict('Sure! Here is the result: {"is_document":true,"type":"passport","confidence":0.7} hope that helps');
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBe('passport');
  });
  it('returns indeterminate for non-JSON garbage', () => {
    expect(parseModelVerdict('I cannot tell from this image.').verdict).toBe('indeterminate');
  });
  it('returns indeterminate for empty input', () => {
    expect(parseModelVerdict('').verdict).toBe('indeterminate');
  });
  it('clamps an out-of-range confidence and drops an unknown type', () => {
    const v = parseModelVerdict('{"is_document": true, "type": "banana", "confidence": 5}');
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBeUndefined();
    expect(v.confidence).toBeUndefined();
  });
});
