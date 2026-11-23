# Notices Hub release — 23 November 2026

Status: production migration and deployment explicitly approved by the user on 23 November 2026; release in progress.

## Delivered
- SmartGate sidebar and mobile More menu: Records & Notices.
- Staff Attendance clock page: My Notices.
- Personal history, scoped register, name/reference/date/status filters, 20-row pages, detailed version history, acknowledgement with reviewer and timestamp.
- Staff can read only their own records. Directors and uniquely staff-ID-linked heads have assigned-directorate access. Superadmin and director-base CD/HoS retain organisation-wide oversight. Email/name alone never grant access. Ordinary admin/IT/reception accounts have no automatic register access.
- Directorate captured at submission; migration uses current assignment for surviving older notices. Existing active absence calculations are preserved; withdrawal retains an independent record. Previously deleted notices cannot be recovered.
- Acknowledgement is receipt, not leave approval. Content revisions reset it. Self-acknowledgement, stale versions, duplicate acknowledgements and acknowledgement after withdrawal are rejected.
- Read/list/acknowledgement audits exclude notice text. API responses are private/no-store; PWA service workers exclude API responses. No additional credentials or paid services.
- Backup and FK-safe restore support new tables, including older pre-hub backups. Explicit full go-live reset also clears retained history after its existing confirmation/backup gate.

## Verification
- API: 605 tests passed; web: 131; staff: 77 (813 total).
- All three TypeScript checks passed.
- Both Vite production builds passed; existing large-bundle/mixed-import warnings remain.
- Seven deployment guard tests passed, including four new notices guard cases.
- Real Chrome desktop 1440px and mobile 390px: own history, register, details, acknowledgement, no horizontal overflow or page errors. Screenshots use synthetic fixtures only.
- Reproduce visuals after building: node scripts/qa-notices-hub.cjs.
- outputs/notices-hub contains desktop, mobile and detail screenshots.

## Production gate and sequence
AGENTS.md requires explicit confirmation before production database mutations. The user explicitly approved this migration and deployment on 23 November 2026. The reviewed migration guard is now enabled.

After explicit approval:
1. Record approval and change the notices migration workflow gate to true. Update the docs card/AGENTS status as part of the release.
2. Commit and push the scoped changes to main. CI tests and builds both PWAs before the targeted migration.
3. The guard checks exact normalised SQL SHA-256, fixed account/database identity, migration ledger, nine table/index/trigger objects, and active-notice coverage. It applies only migration-notices-hub.sql, resumes interrupted application safely, and fails before Worker deployment on any error.
4. Worker and both Pages deploy only after the migration succeeds. Watch CI and smoke tests; verify authenticated personal/director views without creating real personnel notices for testing.
5. Record deployment evidence. Do not claim real notification delivery from mocked UI checks.

The new tables and triggers are additive. Do not drop them to roll back application code: they preserve history independently of the existing active notices. Legacy notifications route to the register; new push alerts link to the exact notice. Email-only head links need an administrator-managed staff ID or director account before receiving hub access.
