---
type: standard
kind: capability
description: Read when getting an iOS build onto a phone, choosing between internal distribution and TestFlight, building in CI, or publishing an over-the-air update.
version: 2.0.0
applies_to: [mobile]
---

# Mobile distribution

Your own phone runs a standalone build within minutes of a change, without Apple review; updates reach only builds that can load them, and TestFlight is used only where it earns its setup.

## Rules

### Builds

- **Default:** internal first. The owner's daily-driver build is `preview-internal`: an ad hoc (`distribution: "internal"`) build of the Preview variant on the `preview` update channel. JavaScript and asset changes reach it as updates; rebuild only when the runtime fingerprint changes.
- **Default:** use TestFlight only for testers whose devices you don't want to register, or as the release-candidate gate before an App Store release, through the store-distribution `preview` profile with its own App Store Connect app. An app already on TestFlight keeps it; `preview-internal` stays its daily driver.
- The daily-driver build uses the production backend, because development deployments are reseeded and wiped. A temporary profile on a development backend (for example, to test an unmerged backend change) is named as such and removed once the change is live.
- **Default:** production, preview and development install side by side. `app.config.ts` picks the name (`<App> Preview`, `<App> Dev`), scheme, bundle ID suffix (`.preview`, `.dev`) and icon from `APP_VARIANT`, which each `eas.json` profile sets. Unset means development, so a local run never replaces another install. Preview and dev icons carry a badge (a blue PREVIEW or orange DEV band on iOS; a pill inside Android's adaptive-icon safe zone) baked into the image files, because a launcher icon changes only with a rebuild.
- Native dependency, config-plugin, entitlement, or runtime changes need a new build. Store submission, signing, production rollout, and device acceptance are separate release tasks.
- **Default:** build locally (`eas build --local`, or the CI build below) to save EAS Build credits. Use cloud builds when the local toolchain can't build the profile.
- Every profile built on EAS's macOS image sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` when `sharp` is in the workspace (for example through wrangler or miniflare). The image ships Homebrew libvips, so sharp's install check chooses a from-source build that has no `node-gyp`, and `pnpm install` fails.
- A profile whose EAS environment has no `SENTRY_AUTH_TOKEN` sets `SENTRY_DISABLE_AUTO_UPLOAD=true`, or the Release build fails at the upload step. Profiles that report errors keep the upload; see [Sentry monitoring](sentry-monitoring.md).
- **Default:** CI builds are opt-in, through PR labels `build:ios` / `build:android` or a manual run of the [caller](mobile-baseline/templates/mobile-build.yml) and [reusable build](mobile-baseline/templates/eas-local-build.yml) workflows: `eas build --local` on the runner, with the binary as a workflow artifact. Gate each platform at job level so an unlabelled push never starts a macOS runner. Pin `eas-cli` as a dev dependency so CI and local builds match.
- CI builds need an `EXPO_TOKEN` secret, cannot read Secret-visibility EAS variables, and cannot answer signing prompts, so iOS ad hoc credentials with registered devices must already exist. GitHub-hosted macOS minutes are free only for public repositories; check a private repository's budget before enabling iOS.

### Updates

- The app config sets `updates.url` (`https://u.expo.dev/<projectId>`) with a `fingerprint` runtime policy. Without `updates.url`, `eas update` publishes but no build ever downloads it.
- Publish updates only through the [publish wrapper](mobile-baseline/templates/publish-update.mjs), as `pnpm mobile:update:<channel>` through `env:exec`, so the Sentry token never lands in a file. The channel sets `APP_VARIANT`, `--environment`, and the source-map upload. A bare `eas update` resolves to the development variant, whose runtime fingerprint no preview or production build has, and nothing reports the mismatch.
- `EXPO_PUBLIC_*` values are inlined at publish time by textual substitution of `process.env.EXPO_PUBLIC_NAME`. Publishing without the channel's environment bakes in the local env file and points production devices at development backends. Read each value with static dot access at every call site; dynamic or destructured reads are not substituted.
- **Default:** add the [fingerprint config](mobile-baseline/templates/fingerprint.config.js) to the mobile target, so editing a `package.json` script does not cut installed builds off from updates. Adding it changes the fingerprint once: rebuild installed preview and production builds before relying on updates. Keep the [baseline](baseline.md) virtual-store path-length setting on every machine: autolinking paths enter the fingerprint.
- **Default:** add a root `.easignore` when the workspace holds local-only files (caches, exports, signing files). It replaces `.gitignore` for uploads, so repeat the ignores that matter.
- **Default:** add the [mobile runtime workflow](mobile-baseline/templates/mobile-runtime.yml). It comments on each PR whether merging needs new builds or can ship as an update, and never fails a PR.
- **Default:** CI publishes the daily-driver channel's update after a merge, once the backend that channel's builds call has deployed. Publishing earlier ships JavaScript that calls functions the backend does not have yet. Gate each platform on the runtime fingerprint (`expo-updates runtimeversion:resolve`): publish only when an earlier update or a finished EAS build on the channel has the same fingerprint; otherwise report in the run summary that a rebuild is due. Skip the publish when nothing the app bundles changed, for example by diffing against a tag the job moves after each publish.
- **Default:** the app offers a restart once an update has downloaded: `useUpdates().isUpdatePending` shows the prompt and `Updates.reloadAsync()` restarts. It also checks again on resume (`checkForUpdateAsync`, then `fetchUpdateAsync`), at most hourly. expo-updates applies a download only on the next cold start, and a phone that is never force-quit may not cold-start for weeks. The app never restarts by itself, because a reload interrupts the user.

| Need | Profile | Distribution | Install |
| --- | --- | --- | --- |
| Live reload from the Mac | `development` | internal (dev client) | `devicectl` or EAS link |
| Own phone, daily use | `preview-internal` | internal (ad hoc) + EAS Update | `devicectl` or EAS link |
| Testers without registered devices; release candidate | `preview` | App Store Connect → TestFlight | TestFlight |
| Store release | `production` | App Store | App Store |

- **Internal:** no App Store Connect app, export-compliance step or processing wait; an install takes seconds. Limits: registered devices only (100 per device family per membership year), and the ad hoc profile lasts as long as the distribution certificate (about a year).
- **TestFlight:** installs on any invited Apple ID, with crash and feedback reports. Costs: about 15–30 minutes of processing per upload, a duplicate-build-number rule on retries, and builds that expire after 90 days.

## Implementation

1. Register each phone once: `eas device:create` (open the link on the phone), or confirm a USB- or Wi‑Fi-paired device with `xcrun devicectl list devices`.
2. Run the first build of each bundle ID yourself (`pnpm exec eas build -p ios --profile preview-internal`): its interactive Apple login creates the ad hoc profile, after which `--non-interactive` builds work in CI and for agents. Repeat one interactive build after adding a device or an app extension (widgets or Live Activities through `expo-widgets`, share or notification extensions). An extension target has its own bundle ID (`<bundle>.<Target>`) and profile, so non-interactive builds fail with "couldn't find any credentials suitable for internal distribution" until then.
3. Build and install:

   ```sh
   pnpm exec eas build -p ios --profile preview-internal --local --output dist/preview.ipa
   xcrun devicectl device install app --device <udid> dist/preview.ipa   # phone unlocked
   ```

   For cloud builds, download the `.ipa` from the build's artifact URL, or open the build page on the phone and tap Install.
4. Copy [fingerprint.mjs](mobile-baseline/templates/fingerprint.mjs) and the publish wrapper into the mobile target's `scripts/`, and add the `mobile:update:<channel>` scripts from the wrapper's header. Publish JavaScript changes:

   ```sh
   pnpm mobile:update:preview --message "<what changed>"
   ```

   The app downloads the update on launch or resume and applies it on the next cold start or from the restart prompt. Local builds are not recorded on EAS, so no fingerprint check can see them: after installing one, publish once with `--without-build` to seed the channel. Custom release tooling can validate a selection with the [OTA guard example](mobile-baseline/examples/ota-guard.ts).

## Verify

- `pnpm exec expo config --type public` shows `updates.url` and `runtimeVersion`.
- The installed build launches with the Mac's Metro stopped, signs in, and reaches the production backend.
- After a test update, a cold start followed by a second cold start shows the change; or resuming shows the restart prompt, and tapping it shows the change.

## Migration

From 1.x: keep existing profiles and TestFlight, add what this standard lists that the app lacks, and replace raw `eas update` publishing with the wrapper.
