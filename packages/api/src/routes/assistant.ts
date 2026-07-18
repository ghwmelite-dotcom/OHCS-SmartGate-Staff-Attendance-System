import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { chat, chatStream } from '../services/assistant';
import { success, error } from '../lib/response';
import { rateLimit } from '../lib/rate-limit';

export const assistantRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1000),
  })).min(1).max(20),
});

async function checkChatRateLimit(c: { env: Env; get: (k: 'session') => SessionData; header: (n: string, v: string) => void }) {
  const session = c.get('session');
  const rl = await rateLimit(c.env, `assistant:${session.userId}`, 30, 300);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return rl;
  }
  return rl;
}

assistantRoutes.post('/chat', zValidator('json', chatSchema), async (c) => {
  const rl = await checkChatRateLimit(c);
  if (!rl.allowed) return error(c, 'RATE_LIMITED', 'Too many chat requests. Slow down a moment.', 429);

  const { messages } = c.req.valid('json');
  const { role } = c.get('session');

  try {
    const reply = await chat(messages, c.env, role);
    return success(c, { reply });
  } catch (err) {
    console.error('[Assistant] Error:', err);
    return error(c, 'AI_ERROR', 'The assistant is temporarily unavailable', 503);
  }
});

assistantRoutes.post('/chat/stream', zValidator('json', chatSchema), async (c) => {
  const rl = await checkChatRateLimit(c);
  if (!rl.allowed) return error(c, 'RATE_LIMITED', 'Too many chat requests. Slow down a moment.', 429);

  const { messages } = c.req.valid('json');
  const { role } = c.get('session');

  try {
    const stream = await chatStream(messages, c.env, role);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[Assistant] Stream error:', err);
    return error(c, 'AI_ERROR', 'The assistant is temporarily unavailable', 503);
  }
});
