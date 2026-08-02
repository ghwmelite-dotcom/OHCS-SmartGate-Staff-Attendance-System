/**
 * daily-summary weekend guard.
 * Cloudflare cron weekday numbering is Quartz-style (1=SUN … 7=SAT), so a
 * "1-5" cron fires Sunday–Thursday — the daily report MUST self-suppress on
 * weekends/holidays in code, the same way the reminder ladders do.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendDailySummary } from './daily-summary';
import type { Env } from '../types';

vi.mock('./telegram', () => ({
  sendTelegramMessage: vi.fn(async () => true),
}));
import { sendTelegramMessage } from './telegram';
const sendMock = vi.mocked(sendTelegramMessage);

function makeEnv() {
  const kv = new Map<string, string>([
    ['app-settings:v2', JSON.stringify({
      work_start_time: '08:00', late_threshold_time: '08:30', work_end_time: '17:00',
      updated_by: null, updated_at: 'x', clockin_reauth_enforce: 0, clockin_pin_attempt_cap: 5,
      clockin_prompt_ttl_seconds: 90, clockin_passive_liveness_enforce: 0,
      clockin_liveness_review_cap_per_week: 2, clockin_liveness_model_version: 'buffalo_s_v1',
      reception_override_pin: null, visitor_photo_retention_days: 30, presence_qr_mode: 0,
      risk_fusion_mode: 0, risk_fusion_block_enabled: 0, reminder_directorate_ids: 'dir_rsimd',
    })],
    ['telegram-admin-chat-id', '555'],
  ]);
  return {
    TELEGRAM_BOT_TOKEN: 't',
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
      delete: async (k: string) => { kv.delete(k); },
    },
    DB: {
      prepare: (sql: string) => ({
        first: async () => (sql.includes('COUNT') ? { c: 0 } : null),
        all: async () => ({ results: [] }),
        run: async () => ({}),
        bind: () => ({
          first: async () => (sql.includes('COUNT') ? { c: 0 } : null),
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      }),
    },
  } as unknown as Env;
}

afterEach(() => {
  sendMock.mockClear();
  vi.useRealTimers();
});

describe('sendDailySummary weekend guard', () => {
  it('does NOT send the daily report on a Sunday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T09:00:00Z')); // Sunday
    await sendDailySummary(makeEnv());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does NOT send the daily report on a Saturday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T09:00:00Z')); // Saturday
    await sendDailySummary(makeEnv());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends the daily report on a weekday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T09:00:00Z')); // Monday
    await sendDailySummary(makeEnv());
    expect(sendMock).toHaveBeenCalled();
  });
});
