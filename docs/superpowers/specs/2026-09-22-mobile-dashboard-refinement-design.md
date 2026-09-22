# Mobile dashboard refinement

The supplied phone screenshot shows header controls extending past the viewport and three tall attendance cards pushing history below the fold. Preserve all data/auth behaviour and the established OHCS visual identity.

## Design direction

Reuse semantic tokens: OHCS green (primary), warm white (surface), cream (background), gold (accent), charcoal (foreground), muted text. Keep existing display/body fonts. Left-aligned content, 16px mobile panel padding, 44px minimum controls. No new palette or motion.

Mobile structure: compact brand + single native theme selector + settings/notifications/help; personal name under heading; full-width daily status above two adjacent clock-time tiles; compact recent-history header. Tablet/desktop retain the three-card row and segmented theme control. This is a density correction, not a redesign into generic metric cards.

Use dynamic viewport height and safe-area offsets. Notification/settings panels must fit the viewport; the assistant panel must fit narrow and short screens. More menu scrolls within available height. Reserve enough main scroll padding to bring final content above the floating assistant and navigation.

## Acceptance

Check 320, 375, 390, 430, 768, 1024 and 1440px layouts including short landscape, long names and dark mode. Check control bounds rather than relying on page scrollWidth (the app clips overflow). Verify notification, settings, theme, assistant and More interactions. Attendance data isolation and refresh remain unchanged. No migration.
