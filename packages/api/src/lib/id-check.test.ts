import { describe, it, expect } from 'vitest';
import {
  parseModelVerdict,
  isBlockingVerdict,
  mostConservativeVerdict,
  type IdCheckVerdict,
} from './id-check';

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

describe('isBlockingVerdict', () => {
  it('blocks a confident not_document', () => {
    expect(isBlockingVerdict({ verdict: 'not_document', confidence: 0.9 })).toBe(true);
  });
  it('does not block a low-confidence not_document', () => {
    expect(isBlockingVerdict({ verdict: 'not_document', confidence: 0.3 })).toBe(false);
  });
  it('blocks a not_document with no confidence (treated as certain)', () => {
    expect(isBlockingVerdict({ verdict: 'not_document' })).toBe(true);
  });
  it('does not block a confident document', () => {
    expect(isBlockingVerdict({ verdict: 'document', confidence: 0.9 })).toBe(false);
  });
  it('does not block indeterminate', () => {
    expect(isBlockingVerdict({ verdict: 'indeterminate' })).toBe(false);
  });
  it('does not block null/undefined', () => {
    expect(isBlockingVerdict(null)).toBe(false);
    expect(isBlockingVerdict(undefined)).toBe(false);
  });
});

describe('mostConservativeVerdict', () => {
  it('a forged body document cannot unblock a KV not_document', () => {
    const doc: IdCheckVerdict = { verdict: 'document', confidence: 0.9 };
    const block: IdCheckVerdict = { verdict: 'not_document', confidence: 0.9 };
    expect(mostConservativeVerdict(doc, block)).toBe(block);
  });
  it('a blocking first arg wins over a non-blocking second', () => {
    const block: IdCheckVerdict = { verdict: 'not_document', confidence: 0.9 };
    const doc: IdCheckVerdict = { verdict: 'document' };
    expect(mostConservativeVerdict(block, doc)).toBe(block);
  });
  it('returns the first non-blocking when neither blocks', () => {
    const ind: IdCheckVerdict = { verdict: 'indeterminate' };
    const doc: IdCheckVerdict = { verdict: 'document' };
    expect(mostConservativeVerdict(ind, doc)).toBe(ind);
  });
  it('falls back to b when a is null', () => {
    const doc: IdCheckVerdict = { verdict: 'document' };
    expect(mostConservativeVerdict(null, doc)).toBe(doc);
  });
  it('returns null when both are null', () => {
    expect(mostConservativeVerdict(null, null)).toBeNull();
  });
});
