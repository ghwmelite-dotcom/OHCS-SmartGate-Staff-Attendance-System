# Plan

1. Compact header and attendance layout using existing tokens and breakpoints.
2. Constrain popovers and assistant; account for dynamic viewport/safe areas.
3. Extend synthetic Chrome smoke checks for control bounds, compact cards, overlays, themes and viewport matrix.
4. Typecheck, web tests, production build, visual critique. Update docs and service worker.
5. Commit scoped files, push and watch deployment/smoke check.

## Verification and review

- Web TypeScript and all 114 tests passed; production build passed with existing bundle-size/mixed-import warnings.
- Synthetic Chrome matrix covers 320, 375, 390, 430, 768, 844 (short landscape), 1024 and 1440px, including staff/admin/director views and long names.
- Bounds checks assert all visible header controls are inside the viewport and at least 44px. Mobile clock tiles share a row and history heading appears above navigation.
- Theme selection, notification/settings panels, assistant bounds, More open/close, manual and automatic refresh, empty/error states checked.
- Browser testing exposed the More backdrop intercepting its close button; navigation now sits above the backdrop. Screenshot review exposed dark-mode green-text contrast; scoped controls now use primary-ink (light #1A4D2E, dark #8FD3A6) without changing primary button backgrounds.
- No attendance data, API, authentication or production database changes.
