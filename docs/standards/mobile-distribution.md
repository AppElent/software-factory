---
type: standard
kind: capability
description: Read when getting an iOS build onto a phone, choosing between internal distribution and TestFlight, or publishing an over-the-air update.
version: 1.0.0
applies_to: [mobile]
---

# Mobile distribution

Your own phone runs a standalone build of the app within minutes of a change, without Apple review, and TestFlight is used only where it earns its setup.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- **Default: internal first.** The owner's daily-driver build is `preview-internal`: an ad hoc (`distribution: "internal"`) build of the Preview variant on the `preview` update channel. JavaScript and asset changes reach it as EAS updates. Rebuild only when the runtime fingerprint changes.
- **Default:** use TestFlight only for testers whose devices you don't want to register, or as the release-candidate gate before an App Store release. Use the store-distribution `preview` profile with its own App Store Connect app. An app that already ships through TestFlight keeps it; `preview-internal` stays its daily driver.
- The daily-driver build uses the production backend. Real use belongs in production data, because development deployments are reseeded and wiped. A temporary profile on a development backend (for example, while an unmerged backend change is tested) must be named as such. Remove it once the change is live.
- **Default:** production, preview and development install side by side. `app.config.ts` picks the name (`<App> Preview`, `<App> Dev`), scheme, bundle ID suffix (`.preview`, `.dev`) and icon from `APP_VARIANT`, which each `eas.json` profile sets. Unset means development, so a local run never replaces another install. The preview and dev icons carry a badge: a blue PREVIEW or orange DEV band along the bottom of the iOS icon, and a pill inside the Android adaptive foreground's safe circle. Badges are baked into the image files because a launcher icon changes only with a rebuild.
- **Default:** build locally (`eas build --local`, or the opt-in CI build in [mobile baseline](mobile-baseline.md#ci-builds)) to save EAS Build credits. Use cloud builds when the local toolchain can't build the profile.
- The app config sets `updates.url` (`https://u.expo.dev/<projectId>`) with a `fingerprint` runtime policy. Without `updates.url`, `eas update` publishes but no build ever downloads it.
- Every profile built on EAS's macOS image sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` when `sharp` is in the workspace, for example through wrangler or miniflare. The image ships Homebrew libvips, so sharp's install check chooses a from-source build that has no `node-gyp`, and `pnpm install` fails.
- A profile whose EAS environment has no `SENTRY_AUTH_TOKEN` sets `SENTRY_DISABLE_AUTO_UPLOAD=true`, or the Release build fails at the upload step. Profiles that report errors keep the upload; see [Sentry monitoring](sentry-monitoring.md).
- **Default:** CI publishes the daily-driver channel's update after a merge, once the backend that channel's builds call has deployed. Publishing earlier ships JavaScript that calls functions the backend does not have yet. Gate each platform on the runtime fingerprint (`expo-updates runtimeversion:resolve`): publish only when an earlier update or a finished EAS build on the channel has the same fingerprint. Otherwise, report in the run summary that a rebuild is due. Skip the publish when nothing the app bundles changed since the last one, for example by diffing against a tag that the job moves after each publish.
- **Default:** the app offers a restart once an update has downloaded. Use `useUpdates().isUpdatePending` to show the prompt and `Updates.reloadAsync()` to restart. It also checks again on resume (`checkForUpdateAsync`, then `fetchUpdateAsync`), at most hourly. expo-updates applies a download only on the next cold start, and a phone that is never force-quit may not cold-start for weeks. The app never restarts by itself, because a reload interrupts whatever the user is doing.

| Need | Profile | Distribution | Install |
| --- | --- | --- | --- |
| Live reload from the Mac | `development` | internal (dev client) | `devicectl` or EAS link |
| Own phone, daily use | `preview-internal` | internal (ad hoc) + EAS Update | `devicectl` or EAS link |
| Testers without registered devices; release candidate | `preview` | App Store Connect → TestFlight | TestFlight |
| Store release | `production` | App Store | App Store |

Trade-offs behind the default:

- **Internal:** no App Store Connect app, export-compliance step or processing wait, and an install takes seconds. Limits: registered devices only (100 per device family per membership year), and the ad hoc profile lasts as long as the distribution certificate (about a year).
- **TestFlight:** installs on any invited Apple ID and gives you crash and feedback reports. Costs: about 15–30 minutes of processing per upload, a duplicate-build-number rule on retries, and builds that expire after 90 days.

## Implementation

1. Register each phone once: `eas device:create` (open the link on the phone), or let `xcrun devicectl list devices` confirm a USB- or Wi‑Fi-paired device.
2. The first build of each bundle ID needs an interactive Apple login, which creates the ad hoc profile on EAS. Run it yourself: `pnpm exec eas build -p ios --profile preview-internal`. After that, `--non-interactive` builds work, including in CI and for agents. Run one interactive build again after adding a device, so the profile is regenerated. Do the same after adding an app extension (widgets or Live Activities through `expo-widgets`, share or notification extensions). The extension's target has its own bundle ID (`<bundle>.<Target>`) and needs its own profile, so non-interactive builds fail with "couldn't find any credentials suitable for internal distribution" until then.
3. Build and install:

   ```sh
   pnpm exec eas build -p ios --profile preview-internal --local --output dist/preview.ipa
   xcrun devicectl device install app --device <udid> dist/preview.ipa   # phone unlocked
   ```

   For cloud builds, download the `.ipa` from the build's artifact URL, or open the build page on the phone and tap Install.
4. Publish JavaScript changes with an explicit environment, which [mobile baseline](mobile-baseline.md#build-and-release-boundaries) requires:

   ```sh
   pnpm exec eas update --channel preview --environment preview -m "<what changed>"
   ```

   The app downloads the update on launch or resume. It applies the update on the next cold start, or when the user taps the app's restart prompt.

   Local builds (`eas build --local`) are not recorded on EAS, so the fingerprint gate cannot see them. After installing one, publish once by hand to seed the channel.

## Verify

- `pnpm exec expo config --type public` shows `updates.url` and `runtimeVersion`.
- The installed build launches with the Mac's Metro stopped, signs in, and reaches the production backend.
- After a test `eas update`, a cold start followed by a second cold start shows the change. Alternatively, resuming the app shows the restart prompt, and tapping the prompt shows the change.

## Migration

Existing apps keep their profiles and add what is missing:

- `preview-internal` (extends `preview`, `distribution: "internal"`);
- per-variant names, bundle IDs and badged icons;
- `updates.url`;
- the `SHARP_IGNORE_GLOBAL_LIBVIPS` and `SENTRY_DISABLE_AUTO_UPLOAD` settings where they apply;
- the restart prompt, and the fingerprint-gated publish after the backend deploy.

Apps with TestFlight keep it.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
