export type IdVerdict = 'document' | 'not_document' | 'indeterminate';
export type IdDetectedType =
  | 'ghana_card' | 'passport' | 'drivers_license' | 'staff_id' | 'other' | 'none';

export interface IdCheckVerdict {
  verdict: IdVerdict;
  detected_type?: IdDetectedType;
  confidence?: number;
  model?: string;
  checked_at?: string;
}

const DETECTED_TYPES: ReadonlySet<string> = new Set([
  'ghana_card', 'passport', 'drivers_license', 'staff_id', 'other', 'none',
]);

// Defensive: vision models return loose text. Extract the first {...} block,
// parse it, and coerce into a verdict. Any failure → indeterminate (never throws).
export function parseModelVerdict(text: string): IdCheckVerdict {
  if (!text) return { verdict: 'indeterminate' };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: 'indeterminate' };

  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { verdict: 'indeterminate' };
  }
  if (typeof obj !== 'object' || obj === null || !('is_document' in obj)) {
    return { verdict: 'indeterminate' };
  }

  const rec = obj as Record<string, unknown>;
  const isDoc = rec.is_document;
  if (typeof isDoc !== 'boolean') return { verdict: 'indeterminate' };

  const result: IdCheckVerdict = { verdict: isDoc ? 'document' : 'not_document' };

  if (typeof rec.type === 'string' && DETECTED_TYPES.has(rec.type)) {
    result.detected_type = rec.type as IdDetectedType;
  }
  if (typeof rec.confidence === 'number' && rec.confidence >= 0 && rec.confidence <= 1) {
    result.confidence = rec.confidence;
  }
  return result;
}
