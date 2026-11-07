// Copy to the mobile target root (next to package.json).
const { SourceSkips } = require("expo/fingerprint");

// Keep Expo's default `balanced` preset, and also ignore package.json scripts:
// they never reach the native binary, and editing one would otherwise strand
// installed builds from OTA updates. `sourceSkips` replaces the preset's
// skips, so they are repeated here. Revisit if an `eas-build-*` hook script
// ever changes the native build.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
	preset: "balanced",
	sourceSkips:
		SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
		SourceSkips.ExpoConfigVersions |
		SourceSkips.ExpoConfigRuntimeVersionIfString |
		SourceSkips.EasJson |
		SourceSkips.Easignore |
		SourceSkips.AutolinkingConfigPaths |
		SourceSkips.PackageJsonScriptsAll,
};
