---
type: standard
kind: capability
description: Read when adding or reviewing error reporting, tracing, replay, feedback, or source-map uploads.
version: 2.3.0
applies_to: [web, mobile, backend]
---

# Sentry monitoring

Each enabled surface reports actionable errors once, with privacy by default, real deployment environments, and symbolicated stacks. Setup detail: [setup](sentry-monitoring/setup.md).

## Rules

- Extend the app's existing SDK initialization, error boundaries, and Sentry project. Never initialize a second client, wrap the same handler twice, or copy an organization, project, DSN, release name, or sample rate from another app.
- Wire each enabled surface where its errors originate:

| Surface | Application wiring | Coverage limit |
| --- | --- | --- |
| Browser | Initialize before hydration; connect React/route errors and the router's supported tracing integration | Only code executed by that browser |
| Expo native | Initialize once, wrap the root, connect navigation, and configure native build integration | Native crashes/profiling/replay require a compatible built binary and device verification |
| Cloudflare SSR | Instrument the actual Worker fetch entry using the installed SDK's supported wrapper or build integration | A framework may swallow the original exception and return a 500 |
| Convex | Choose managed exception reporting or an independently hosted log forwarder | Client capture alone cannot observe unattended backend failures |

- Use stable surface tags (`app=product-web`, `product-mobile`, `product-web-server`, `product-convex`). Document whether surfaces share a project in the app's runbook. Clear the opaque user ID on sign-out; attach no email/name by default.
- Capture actionable caught failures at one common boundary, preserve the original error and stack, and rethrow so UI handling still runs. Never capture function arguments/results. Deduplicate repeated capture. Do not propagate trace headers to third parties without an intentional integration.
- Derive environment names from deployment identity, not build mode. **Default:** local delivery is disabled on both browser and server by checking the parsed hostname (see [setup](sentry-monitoring/setup.md#environments-and-local-previews)).
- The DSN is public; `SENTRY_AUTH_TOKEN` only authorizes uploads and never lands in `VITE_*`, `EXPO_PUBLIC_*`, a bundle, event data, or tracked dotenv files. Route values through [environments](environments.md).
- Upload source maps only from builds that are deployed or distributed (previews, production, store/OTA releases). Check-only CI builds that verify bundling run without `SENTRY_AUTH_TOKEN`, so they create no release per run; keep the build-time environment tag so a check build is never mistaken for a deployment.
- Upload hidden source maps for the exact artifact, then remove public client maps before deployment. Native releases need debug symbols; OTA updates need maps for the exact exported update.
- Backend coverage needs managed Convex reporting or an always-on log forwarder; record inactive coverage explicitly. **Default:** the forwarder is the toolkit's [Convex log forwarder](sentry-monitoring/examples/convex-sentry.mjs), copied to `scripts/`.
- Disable automatic PII. Redact query strings, bodies, headers, cookies, stack locals, extras, credentials, and sensitive text before delivery. Replay masks text/inputs and blocks media by default.
- Choose tracing, profiling, replay, and error sampling deliberately and document expected cost. Configure alerts and retention separately.

## Implementation

1. Wire each surface per the table above. [Setup](sentry-monitoring/setup.md) has per-surface detail, credentials and source-map upload, and Convex reporting.
2. Add the local-reporting guard to browser and server paths with its regression test (localhost SSR 500 with production bindings never enters the wrapper), then rebuild or restart running previews so old artifacts stop reporting.

## Verify

- Focused tests cover privacy, duplicate capture, local suppression, and deployed wrapper dispatch.
- Build web and mobile artifacts; verify initialization order and absence of public secrets/maps.
- In an authorized test environment, send a controlled error per enabled surface and inspect environment, release, surface tag, user policy, original stack, and redaction.
- Confirm an uploaded map resolves a generated stack.
- Test a compatible native binary on a device and test an OTA update separately when supported.
- For backend coverage, verify the chosen managed integration or hosted forwarder with an unattended failure.
