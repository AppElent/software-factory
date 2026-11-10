---
type: standard
kind: platform
description: Read when setting up or changing an Expo Router app, its native configuration, or its EAS build profiles.
version: 3.0.0
applies_to: [mobile]
---

# Mobile baseline

Expo apps share one stack while preserving native identity and release boundaries.

## Rules

### Stack

- Mobile projects use Expo, React Native, and Expo Router on the [shared baseline](baseline.md) (pnpm, TypeScript, Biome, CI, dependency policy). Behavior tests use Jest with jest-expo and React Native Testing Library.
- Select SDK-compatible packages with `pnpm exec expo install`; actual versions live in package and lock files. Do not copy another app's native dependency versions.
- On Expo SDK 57 or newer, [Expo Device Hub](https://github.com/expo/expo-device-hub) is the local simulator/emulator dashboard, installed as development tooling in the Expo target. Older SDKs keep their device workflow until a deliberate SDK upgrade.
- One React version across web and mobile: the root web package pins the exact `react` and `react-dom` versions the Expo SDK installs in `apps/mobile`, so the lockfile resolves one React. A different web version is a recorded exception naming the SDK upgrade that ends it.
- `apps/mobile/tsconfig.json` extends `expo/tsconfig.base` and keeps the root's strictness flags ([baseline](baseline.md)). Shared code layout: [repository layout](repo-layout.md).

### UI

- Native navigation and platform controls sit behind app-owned component interfaces. Check the installed Expo UI skill for SDK-compatible `@expo/ui` controls before adding another control library. Validated forms use TanStack Form with Zod behind those interfaces.
- Colors, spacing, typography, and motion are semantic tokens. Do not copy the web Tailwind/DOM layer into native screens.
- Large collections use a virtualized list; grouped native rows are not virtualized.

### Code boundaries

- Share domain logic through a workspace module when there are real callers. Platform adapters, token storage, permissions, and native lifecycle handling stay in the mobile target. Native code never imports browser globals, DOM components, or server-only modules.
- Backend and auth choices, identities, themes, supported platforms and locales, and release profiles are project-owned. Existing apps keep their tested adapters until an explicit migration is verified.
- Register app identity, scheme, EAS project, permissions, assets, and credentials deliberately.
- Wire [auth](auth.md) (including [session readiness](auth.md#session-readiness-and-protected-data)) and [i18n](i18n.md) through their native adapters.
- Route `EXPO_PUBLIC_*` values through [environments](environments.md). A physical device needs a device-reachable backend URL; its localhost is not the development machine.

### EAS profiles

- The starter `eas.json`: development enables a development client and internal distribution, preview is the store-distribution profile on the `preview` channel, `preview-internal` extends it as the internal (ad hoc) build, and production uses remote version ownership. Review them before the first EAS build, add profile-specific environment and channel mappings explicitly, and keep existing release profiles intact.
- Builds on phones, TestFlight, over-the-air updates, runtime fingerprints, and CI builds: [mobile distribution](mobile-distribution.md).

## Implementation

1. Start from the current upstream Expo Router scaffold. In a monorepo, run the baseline at the mobile target, not the web root:

   ```sh
   node scripts/baseline-mobile.mjs --path apps/mobile --dry-run
   node scripts/baseline-mobile.mjs --path apps/mobile --apply
   ```

   It adds missing Expo run scripts, a starter `eas.json` when absent, and applicable shared repository settings. Existing SDK versions, routes, bundle IDs, Android package IDs, scheme, EAS project ID, profiles, and app config are preserved. Install `expo-dev-client` before using the development-client start command ([development builds](https://docs.expo.dev/develop/development-builds/introduction/)).

2. On SDK 57+, install Device Hub from the mobile directory:

   ```sh
   pnpm exec expo install expo-device-hub --dev --pnpm
   pnpm exec expo start --dev-client
   ```

   It registers itself; open the URL Metro prints (`/_expo/plugins/expo-device-hub` on the selected port). iOS simulators need macOS and Xcode; Android emulators need the Android SDK with `emulator` and `adb`. Its `node-datachannel` dependency needs its native binary for Android streaming: review that install script and allow it in the workspace's build ledger. Do not disable script checks globally.

## Verify

- Types, app tests, and Expo dependency checks pass.
- An actual development or internal build runs on a device or simulator: cold and warm launch, login and logout, navigation, keyboard, safe areas, scaling, offline and error states, and backend reachability. Native interactions need native verification, not screenshots of the web app; follow the applicable [iOS](ios-design.md) and [Android](android-design.md) rules.
- Device Hub loads and the intended device connects.
- A missing provider credential or untested device path is reported as outstanding work.

## Migration

From 2.x: OTA publishing, fingerprints, and CI builds moved to [mobile distribution](mobile-distribution.md); template paths are unchanged. Apps from before 2.5 also align the root `react`/`react-dom` pins with `apps/mobile` (or record the exception) and add the root's strictness flags to `apps/mobile/tsconfig.json`.
