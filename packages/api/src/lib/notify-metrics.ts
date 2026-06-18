export type NotifyChannel = 'telegram' | 'push';

// Records a delivery outcome: a structured production log line (visible via
// `wrangler tail` / Logpush) + a best-effort KV daily counter. Logs carry only
// channel/outcome/status — never the message body or any visitor PII. Never
// throws into the delivery path.
export async function recordNotifyOutcome(
  env: { KV: KVNamespace },
  channel: NotifyChannel,
  ok: boolean,
  detail?: string,
): Promise<void> {
  const line = JSON.stringify({ kind: 'notify', channel, ok, ...(detail ? { detail } : {}) });
  if (ok) console.log(line); else console.warn(line);
  try {
    const date = new Date().toISOString().slice(0, 10);
    const key = `notify-stat:${date}:${channel}:${ok ? 'ok' : 'fail'}`;
    const raw = await env.KV.get(key);
    const n = raw ? parseInt(raw, 10) : 0;
    await env.KV.put(key, String(n + 1), { expirationTtl: 35 * 86400 });
  } catch {
    // Counters are best-effort — never let them affect delivery.
  }
}

// Web Push statuses that mean the subscription is dead and should be removed.
export function isDeadPushStatus(status: number): boolean {
  return status === 404 || status === 410;
}
