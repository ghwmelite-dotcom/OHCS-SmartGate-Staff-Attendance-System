import type { Env } from '../types';

export interface AppSettings {
  work_start_time: string;      // "HH:MM"
  late_threshold_time: string;  // "HH:MM"
  work_end_time: string;        // "HH:MM"
  updated_by: string | null;
  updated_at: string;
  // Clock-in re-auth + liveness (added by migration-clockin-reauth.sql)
  clockin_reauth_enforce: number;       // 0 = soft (record but don't reject), 1 = enforce
  clockin_pin_attempt_cap: number;      // PIN re-auth attempts allowed before lockout
  clockin_prompt_ttl_seconds: number;   // Prompt validity window
  // Passive liveness (Plan 1.5) — added by migration-passive-liveness.sql
  clockin_passive_liveness_enforce: number;        // 0 = shadow, 1 = enforce
  clockin_liveness_review_cap_per_week: number;    // manual-review escape valve
  clockin_liveness_model_version: string;          // 'buffalo_s_v1' etc — surfaced into signature
  // Reception override PIN (added by migration-reception-override-pin.sql)
  reception_override_pin: string | null;           // NULL/empty = overrides disabled
  // Visitor photo retention (added by migration-visitor-photo-retention.sql)
  visitor_photo_retention_days: number;            // days after last checkout before ID/face photos are purged
  // Presence QR (added by migration-clock-presence.sql)
  presence_qr_mode: number; // 0 = off, 1 = shadow, 2 = enforce
  // Attendance risk fusion (added by migration-clock-risk.sql)
  risk_fusion_mode: number;           // 0 = off, 1 = shadow (persist+log only), 2 = enforce
  risk_fusion_block_enabled: number;  // 0 = ≥60 band flags only, 1 = ≥60 may block (guardrail still applies)
}

const KV_KEY = 'app-settings:v2';
const KV_TTL = 300;          // 5 min KV cache
const MEMO_TTL_MS = 60_000;  // 60s per-isolate memo

const DEFAULTS: AppSettings = {
  work_start_time: '08:00',
  late_threshold_time: '08:30',
  work_end_time: '17:00',
  updated_by: null,
  updated_at: '1970-01-01T00:00:00Z',
  clockin_reauth_enforce: 0,
  clockin_pin_attempt_cap: 5,
  clockin_prompt_ttl_seconds: 90,
  clockin_passive_liveness_enforce: 0,
  clockin_liveness_review_cap_per_week: 2,
  clockin_liveness_model_version: 'buffalo_s_v1',
  reception_override_pin: null,
  visitor_photo_retention_days: 30,
  presence_qr_mode: 0,
  risk_fusion_mode: 0,
  risk_fusion_block_enabled: 0,
};

let memo: { value: AppSettings; ts: number } | null = null;

export async function getAppSettings(env: Env): Promise<AppSettings> {
  const now = Date.now();
  if (memo && now - memo.ts < MEMO_TTL_MS) return memo.value;

  const cached = await env.KV.get(KV_KEY, 'json') as AppSettings | null;
  if (cached) {
    memo = { value: cached, ts: now };
    return cached;
  }

  const row = await env.DB.prepare(
    `SELECT work_start_time, late_threshold_time, work_end_time, updated_by, updated_at,
            clockin_reauth_enforce, clockin_pin_attempt_cap, clockin_prompt_ttl_seconds,
            clockin_passive_liveness_enforce, clockin_liveness_review_cap_per_week,
            clockin_liveness_model_version, reception_override_pin,
            visitor_photo_retention_days, presence_qr_mode,
            risk_fusion_mode, risk_fusion_block_enabled
     FROM app_settings WHERE id = 1`
  ).first<AppSettings>();

  const settings = row ?? DEFAULTS;
  await env.KV.put(KV_KEY, JSON.stringify(settings), { expirationTtl: KV_TTL });
  memo = { value: settings, ts: now };
  return settings;
}

export async function invalidateSettingsCache(env: Env): Promise<void> {
  memo = null;
  await env.KV.delete(KV_KEY);
}

// "HH:MM" → "HH:MM:00" for SQLite TIME() comparison
export function toSqlTime(hhmm: string): string {
  return `${hhmm}:00`;
}

// "HH:MM" → minutes since midnight
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
