// Formatting helpers for appointment time slots. Slots are "HH:MM" start
// times (same shape as the public slots endpoint and the time_slot column).

/** Add minutes to an "HH:MM" slot, returning the end time as "HH:MM". */
export function slotEndTime(slot: string, durationMins: number): string {
  const [h = 0, m = 0] = slot.split(':').map(Number);
  const total = h * 60 + m + durationMins;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Render a proposed appointment slot for display, e.g. "Wed 5 Aug, 10:00–10:30".
 * When the officer's slot duration is unknown, just the start time is shown
 * ("Wed 5 Aug, 10:00").
 */
export function formatProposedSlot(
  date: string,
  slot: string,
  durationMins?: number | null
): string {
  const d = new Date(date + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const timeLabel =
    durationMins && durationMins > 0 ? `${slot}–${slotEndTime(slot, durationMins)}` : slot;
  return `${dateLabel}, ${timeLabel}`;
}
