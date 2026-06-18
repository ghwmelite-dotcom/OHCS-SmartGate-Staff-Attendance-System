import { describe, it, expect } from 'vitest';
import { checkIdDocument } from './id-check';
import type { Env } from '../types';

function envWith(run: (model: unknown, input: unknown) => Promise<unknown>): Env {
  return { AI: { run } } as unknown as Env;
}
const bytes = new Uint8Array([1, 2, 3]).buffer;

describe('checkIdDocument', () => {
  it('returns a document verdict from the model response, tagging model + checked_at', async () => {
    const env = envWith(async () => ({ response: '{"is_document":true,"type":"ghana_card","confidence":0.9}' }));
    const v = await checkIdDocument(env, bytes);
    expect(v.verdict).toBe('document');
    expect(v.detected_type).toBe('ghana_card');
    expect(v.model).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(typeof v.checked_at).toBe('string');
  });
  it('returns not_document when the model says so', async () => {
    const env = envWith(async () => ({ response: '{"is_document":false,"type":"none","confidence":0.6}' }));
    expect((await checkIdDocument(env, bytes)).verdict).toBe('not_document');
  });
  it('degrades to indeterminate when the model throws (e.g. license/agreement error)', async () => {
    const env = envWith(async () => { throw new Error('license required'); });
    expect((await checkIdDocument(env, bytes)).verdict).toBe('indeterminate');
  });
  it('degrades to indeterminate on timeout', async () => {
    const env = envWith(() => new Promise(() => { /* never resolves */ }));
    const v = await checkIdDocument(env, bytes, 20);
    expect(v.verdict).toBe('indeterminate');
  });
  it('passes the image as a byte array and a prompt', async () => {
    let received: Record<string, unknown> = {};
    const env = envWith(async (_m, input) => { received = input as Record<string, unknown>; return { response: '{"is_document":true}' }; });
    await checkIdDocument(env, bytes);
    expect(Array.isArray(received.image)).toBe(true);
    expect(typeof received.prompt).toBe('string');
  });
});
