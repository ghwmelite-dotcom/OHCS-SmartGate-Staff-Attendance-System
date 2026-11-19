# Flexible NSS identifiers — implementation

1. Replace fixed-format checks with normalised, bounded string validation in manual registration and both import routes.
2. Match the frontend schema, input limit and import guidance; update the feature catalogue.
3. Test new/legacy formats, leading zeros, normalisation and invalid inputs; typecheck and run API/web suites.
4. Inspect the registration form in Chrome using synthetic data, then commit scoped files, push and monitor deployment.
