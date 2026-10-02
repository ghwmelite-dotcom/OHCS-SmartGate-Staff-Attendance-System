# Self-reported clock-out

Approved scope: Staff Attendance only. Keep clock-in and normal on-site clock-out verification unchanged. Add a discreet “Already left the office?” action for an authenticated officer with an open attendance day. No GPS, QR or camera is required on this separate path; PIN or registered passkey verification is mandatory regardless of the normal clock enforcement setting.

Officers choose “Just left” (server time) or “Left earlier” (today's Ghana/UTC departure time). Accept only a departure at or after today's recorded clock-in and at or before server submission. Reject prior-day correction, a second departure, invalid authentication and unowned credentials. Require a stable idempotency key and an owned, unexpired clock prompt. Do not queue offline: show a retryable failure, never success before server acknowledgement.

Persist reported_departure_at separately from the immutable clock_records.timestamp submission time. NULL means the existing verified path; non-NULL means self-reported, including “Just left”. Record no fabricated geofence or liveness evidence. This is a departure declaration, not approval for early leave.

Attendance views, early-departure checks, working-time calculations and exports use the declared departure for self-reports, label them Self-reported and retain submission time. Staff status shows the same distinction. Conditional insertion prevents simultaneous normal and self-reported requests creating duplicate daily records.

Keep every reminder cron and slot unchanged: 15:30–17:00. Update evening copy to explain the fallback without implying a missing clock-out proves physical presence. A successful self-report is a clock_out record, so subsequent audience queries exclude it. Already dispatched notifications cannot be recalled.

Rollout requires one additive database column. Prepare and verify locally; production migration requires explicit approval before deploying code that reads the new column. No production changes without that gate.
