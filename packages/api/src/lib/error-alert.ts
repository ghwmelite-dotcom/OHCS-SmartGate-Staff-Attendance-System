import type { Env } from '../types';
import { escapeHtml } from './html';
import { sha256Hex } from '../db/migrations-index';
import { sendToAdminSubscribers } from '../services/daily-summary';

/**
 * Throttled Telegram admin error alerting.
 *
 * Surfaces otherwise-silent failures (cron jobs, unhandled request errors) to
 * admins via Telegram. Guarantees:
 *   - Production only — a no-op when env.ENVIRONMENT !== 'production'.
 *   - PII-free — sends only the caller-supplied context label (e.g. a route or
 *     'cron:backup') plus the error name/message. NEVER request bodies or rows.
 *   - Throttled — at most one alert per error signature per hour, via a KV key
 *     `erroralert:<sha256(context+message)>` with a 1h TTL.
 *   - Can never throw into the caller — the whole body is wrapped in try/catch,
 *     so it is safe to call fire-and-forget from middleware or cron.
 */

const THROTTLE_TTL_SECONDS = 3600; // 1 alert / hour / signature
const MAX_MESSAGE_CHARS = 200;

export async function alertAdminError(
  env: Env,
  context: string,
  err: unknown,
): Promise<void> {
  try {
    if (env.ENVIRONMENT !== 'production') return;

    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);

    // Throttle on a stable signature so a recurring error doesn't spam admins.
    const signature = `${context}:${message}`;
    const hash = await sha256Hex(signature);
    const key = `erroralert:${hash}`;

    if (await env.KV.get(key)) return; // already alerted within the TTL window
    await env.KV.put(key, '1', { expirationTtl: THROTTLE_TTL_SECONDS });

    const detail = `${name}: ${message}`.slice(0, MAX_MESSAGE_CHARS);
    const text = [
      '⚠️ <b>App error</b>',
      escapeHtml(context),
      escapeHtml(detail),
    ].join('\n');

    await sendToAdminSubscribers(text, env);
  } catch (alertErr) {
    // Alerting must never throw into the caller (request handler / cron).
    console.error(
      `[error-alert] failed to send alert: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`,
    );
  }
}
