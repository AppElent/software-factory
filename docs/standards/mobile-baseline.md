---
type: standard
kind: platform
description: Read when setting up or changing an Expo Router app, its native configuration, or release boundaries.
version: 2.5.0
applies_to: [mobile]
---

# Mobile baseline

Expo apps share one stack while preserving native identity and release boundaries.

## Rules

### Standard

All current mobile projects use Expo, React Native, and Expo Router. Use the [shared baseline](baseline.md) for pnpm, TypeScript, Biome, CI, and dependency policy; use Jest with jest-expo and React Native Testing Library for behavior tests. Select SDK-compatible packages through `pnpm exec expo install`, keeping actual versions in package/lockfiles.

Use [Expo Device Hub](https://github.com/expo/expo-device-hub) as the standard local simulator/emulator dashboard on Expo SDK 57 or newer. Install it as development tooling in the Expo target. Older SDKs retain their existing device workflow until a deliberate SDK upgrade.

Use native navigation and platform controls behind app-owned component interfaces. Consult the installed Expo UI skill for SDK-compatible @expo/ui controls before adding another control library. Use TanStack Form with Zod for validated forms behind those interfaces. Keep colors, spacing, typography, and motion in semantic tokens; do not copy the web Tailwind/DOM layer into native screens. iOS uses native chrome and SF Symbols; Android follows its own navigation/control conventions while preserving product outcomes. Large collections need a virtualized list; grouped native rows do not establish virtualization.

One React version across web and mobile: the root web package pins the exact `react` and `react-dom` versions the Expo SDK installs in `apps/mobile`, so the lockfile resolves one React. A different web version is a recorded exception with its reason and the SDK upgrade that ends it. `apps/mobile/tsconfig.json` extends `expo/tsconfig.base` and keeps the root's strictness flags ([baseline](baseline.md)). Shared code layout: [repository layout](repo-layout.md).

Share domain logic through a workspace module when there are real callers. Keep platform adapters, token storage, permissions, and native lifecycle handling in the mobile target. Backend/auth choices, identities, themes, supported platforms/locales, and release profiles remain project-owned. Existing apps retain their tested adapters until an explicit migration is verified.

### Build and release boundaries

The development profile enables a development client and internal distribution; preview creates an internal build; production uses remote version ownership. Review and adapt those choices before the first EAS build. Which profile goes onto which phone, when TestFlight is worth it, and the EAS build pitfalls are in [mobile distribution](mobile-distribution.md). Add profile-specific environment/channel mappings explicitly. Keep existing release profiles intact.

For pnpm builds across Windows/macOS, keep the same virtual-store path-length policy: native autolinking paths can affect Expo fingerprints even with identical package versions.

**Default:** add the [fingerprint config](mobile-baseline/templates/fingerprint.config.js) to the mobile target. It keeps Expo's `balanced` preset but leaves `package.json` scripts out of the fingerprint: they never reach the binary, and editing one would otherwise cut every installed build off from updates. Add a root `.easignore` when the workspace holds local-only files (caches, exports, signing files) that must not be uploaded; it replaces `.gitignore` for uploads, so repeat the ignores that matter.

Native dependency, config-plugin, entitlement, or runtime changes require a compatible binary. The [OTA guard example](mobile-baseline/examples/ota-guard.ts) compares resolved runtime evidence, profile, environment, and channel. It does not query EAS and a fingerprint policy string is not a resolved runtime fingerprint. No update command is generated automatically. Store submission, signing, production rollout, and device acceptance remain separate tasks.

Publish over-the-air updates only through the [publish wrapper](mobile-baseline/templates/publish-update.mjs), run through `env:exec` so the Sentry token never lands in a file. It derives everything that must match the installed build from the channel: `APP_VARIANT` (when the app config picks bundle ID, scheme or icon from it, a bare `eas update` resolves to the development variant, whose runtime fingerprint no preview or production build has, and nothing reports the mismatch), `--environment`, and the source-map upload from the exact `dist/` just published. Before publishing it checks that a finished build on the channel has this checkout's runtime fingerprint (computed by [fingerprint.mjs](mobile-baseline/templates/fingerprint.mjs), which matches what EAS records), and refuses when none does, because no installed app would load the update; `--without-build` overrides that for publishing ahead of a build. Production refuses to publish without the token; `--upload-only` retries a failed upload without publishing again. Every update carries an explicit environment (`eas update --environment <name>`, paired with its channel). `EXPO_PUBLIC_*` values are inlined into the bundle at publish time by textual substitution of `process.env.EXPO_PUBLIC_NAME`, so a bare publish bakes in the publishing machine's local env file and points production devices at development backends. Static dot access at every call site is load-bearing: dynamic or destructured reads are not substituted.

**Default:** add the [mobile runtime workflow](mobile-baseline/templates/mobile-runtime.yml). On every PR that touches the mobile target, the lockfile or patches, it compares the runtime fingerprint of base and head per variant and platform, and comments whether the PR needs new builds after merging or can ship as an update. It is informational and never fails a PR. Both checkouts need their own install, because native modules are fingerprinted from `node_modules`.

### CI builds

Native CI builds are opt-in and spend no EAS Build credits: they run `eas build --local` on the CI runner (macOS for iOS, Linux for Android) and upload the binary as an artifact. Use the [caller](mobile-baseline/templates/mobile-build.yml) and [reusable build](mobile-baseline/templates/eas-local-build.yml) workflow templates: per-platform PR labels `build:ios` / `build:android` build the development profile when added and on pushes while present, and a manual run selects platform, branch, and profile. Gate each platform at job level so an unlabelled push never starts a macOS runner. Pin `eas-cli` as a dev dependency so CI and local builds use the same version. Local builds still need an `EXPO_TOKEN` secret for the project, profile environment, and managed credentials; Secret-visibility EAS variables are not available, and CI cannot answer signing prompts, so iOS ad hoc credentials with registered devices must already exist. GitHub-hosted macOS minutes are free only for public repositories; private repositories should check their minute budget before enabling iOS. Store submission stays a separate release step.

Run types, app tests, Expo dependency checks, and an actual dev/internal build. Verify cold/warm launch, login/logout, navigation, keyboard, safe areas, scaling, offline/error states, and device reachability. A missing provider credential or untested device path remains outstanding work.

## Implementation

### Setup

Use the current upstream Expo Router scaffold and select SDK-compatible dependencies with Expo tooling. Do not copy another app's native dependency versions. In a monorepo, run the baseline at the mobile target, not the web root:

```sh
node scripts/baseline-mobile.mjs --path apps/mobile --dry-run
node scripts/baseline-mobile.mjs --path apps/mobile --apply
```

This adds missing Expo run scripts and a starter eas.json when absent, alongside applicable shared repository settings. Existing SDK versions, routes, bundle IDs, Android package IDs, scheme, EAS project ID, profiles, and app config are preserved. Install expo-dev-client before using the generated development-client start command. See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

For SDK 57+ targets, install Device Hub from the mobile directory:

```sh
pnpm exec expo install expo-device-hub --dev --pnpm
pnpm exec expo start --dev-client
```

The plugin registers automatically; open the Device Hub URL printed by Metro (under `/_expo/plugins/expo-device-hub` on the selected port). No application import or config plugin is required. iOS simulators need macOS and Xcode; Android emulators need the Android SDK with `emulator` and `adb`. Follow the existing pnpm build-script policy: Device Hub's `node-datachannel` dependency needs its native binary for Android streaming. Review that install script and explicitly allow it in the workspace's build ledger; do not disable script checks globally. Verify the dashboard loads and the intended device connects. Dashboard availability alone does not establish application acceptance.

### Application integration

- Keep native code in the Expo target and share domain logic through an app-owned workspace module. Do not import browser globals, DOM components, or server-only modules into native code.
- Register app identity, scheme, EAS project, permissions, assets, and credentials deliberately. Local source generation does not create provider accounts or prove signing readiness.
- Use [auth](auth.md) for Clerk/Convex and official native token storage. Follow [session readiness and protected data](auth.md#session-readiness-and-protected-data): navigation follows loaded Clerk state; protected data providers sit below a Convex authentication gate, with the Clerk/Convex bridge mounted above it.
- Use [i18n](i18n.md) with device-locale and persistence adapters. Keep translated copy, glossary, navigation, provisioning, and account cleanup app-owned.
- Route EXPO_PUBLIC_ values through [environments](environments.md). They are embedded public values, never secret storage. Use a device-reachable backend URL; localhost on a physical device is not the development machine.
- Read general/mobile guidance and the applicable iOS/Android rules. Native interactions need native verification, not screenshots from the web app.

## Migration

Replace mobile.foundation recipe configuration with this focused setup and app-owned wiring. Keep existing identities and workspace modules. The historical mobile.release guard is retained as an example, without freezing the old SDK version table. Runtime package removal and live app migration are separate from installing this guide.

2.4.0: apps that publish with a raw `eas update` or their own script copy the publish wrapper and `fingerprint.mjs`, set its Sentry org and project, add `mobile:update:<channel>` scripts through `env:exec`, and update their runbook. Adding the fingerprint config changes the runtime fingerprint once, so rebuild installed preview and production builds before relying on OTA updates.

2.5.0: align the root `react`/`react-dom` pins with the version in `apps/mobile`, or record the exception. Add the root's strictness flags to `apps/mobile/tsconfig.json`.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
