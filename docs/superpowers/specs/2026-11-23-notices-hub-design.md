# Staff Records & Notices Hub — phase one

The hub retains absence notices independently of the active absence calculation. Existing withdrawals continue to remove active absence coverage; a transactionally maintained register retains the original record and revision history. Acknowledgement is receipt, never leave approval.

## Access
Authenticated staff read their own records. Directors read and acknowledge records in their currently assigned directorate; configured heads with a unique administrator-managed staff ID link receive the same scoped capability. Chief Director, Head of Service and superadmin have organisation-wide oversight, consistent with existing oversight/fallback responsibilities. Admin, IT and reception roles do not automatically gain confidential register access. Missing scope fails closed. Self-editable email/name are never used to grant access. Directorate is captured at submission; legacy rows use the current directorate at migration time. Transfers do not silently reassign historical records. Self-acknowledgement is prohibited.

## Persistence and API
Add notice_register and notice_revisions, backfill surviving absence_notices, and install SQLite triggers so insert/update/delete and register updates are atomic. No old deleted notices can be recovered. Changed content increments version and resets acknowledgement; withdrawal retains history. An acknowledgement uses an expected version and conditional update to reject stale or racing actions. Paginated, filtered list, own history, detail with revisions, and acknowledgement endpoints all scope on the server. Private responses are no-store. Reads and acknowledgements are audited without notice text.

## UI
SmartGate Records & Notices route with My Notices and permitted register views, search/date/status filters, pagination, readable details, revision history and explicit acknowledgement. Staff PWA My Notices page linked from clock screen, sharing the same interaction pattern and brand tokens. Loading/error/empty states, keyboard controls and responsive layouts.

## Release gate
Additive production migration requires explicit user confirmation under AGENTS.md. Finish implementation, tests and local screenshots before requesting it. Do not push code that reads missing tables before migration sequencing is approved. Retention policy and delegated access are later phases.
