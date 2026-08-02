/**
 * scheduled() cron '0 9 1 * *' (monthly) must NOT fire sendDailySummary on
 * Jan 1 — Quartz numbering means the yearly cron '0 9 1 1 *' ALSO matches
 * Jan 1 09:00, so both crons fire and the summary would be sent twice.
 * sendMonthlyReportReady still runs either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./services/daily-summary', () => ({
  sendDailySummary: vi.fn(async () => {}),
}));
vi.mock('./services/reminders', () => ({
  sendClockReminders: vi.fn(async () => {}),
  sendClockOutReminders: vi.fn(async () => {}),
  sendMonthlyReportReady: vi.fn(async () => {}),
}));

import worker from './index';
import { sendDailySummary } from './services/daily-summary';
import { sendMonthlyReportReady } from './services/reminders';
import type { Env } from './types';

const dailyMock = vi.mocked(sendDailySummary);
const monthlyMock = vi.mocked(sendMonthlyReportReady);

async function runScheduled(cron: string) {
  const waits: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { waits.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  worker.scheduled!(
    { cron, scheduledTime: Date.now() } as unknown as ScheduledEvent,
    {} as Env,
    ctx,
  );
  await Promise.all(waits);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("scheduled() — cron '0 9 1 * *' (monthly)", () => {
  it('does NOT send the daily summary on Jan 1 (the yearly cron covers it), but still runs the monthly report', async () => {
    vi.setSystemTime(new Date('2027-01-01T09:00:00Z')); // Jan 1
    await runScheduled('0 9 1 * *');
    expect(dailyMock).not.toHaveBeenCalled();
    expect(monthlyMock).toHaveBeenCalledTimes(1);
  });

  it('sends the daily summary on any other 1st-of-month', async () => {
    vi.setSystemTime(new Date('2026-02-01T09:00:00Z')); // Feb 1
    await runScheduled('0 9 1 * *');
    expect(dailyMock).toHaveBeenCalledTimes(1);
    expect(monthlyMock).toHaveBeenCalledTimes(1);
  });
});
