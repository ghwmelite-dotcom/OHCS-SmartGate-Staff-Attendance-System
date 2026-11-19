# Flexible NSS identifiers

Accept NSS identifiers without a fixed prefix or digit count, including GUPS72599144826. Apply the same policy to manual registration and both NSS import endpoints. Trim outer whitespace and uppercase before validation and duplicate checks. Require 1–32 characters (matching PIN/passkey login), excluding control characters. Preserve punctuation, internal spaces and leading zeros. Existing uniqueness checks and generated PINs remain in place. Update form hints, input limit and import documentation. No migration is needed.

Verify legacy, current and future-shaped identifiers, normalisation, empty/control/oversized input rejection; run API/web typechecks and tests and inspect the registration form in Chrome.
