// Copy to <mobile target>/scripts/publish-update.mjs, next to fingerprint.mjs,
// and set SENTRY_ORG and SENTRY_PROJECT below. Publishes an over-the-air
// update to a build channel and uploads its source maps. Run it through
// env:exec, which adds the Sentry token from the secret store without
// writing it to a file:
//
//   "mobile:update:preview": "node scripts/env.mjs exec preview --only eas -- node apps/mobile/scripts/publish-update.mjs preview"
//   pnpm mobile:update:preview --message "…"
//   pnpm mobile:update:production --upload-only   (retry the maps upload only)
//
// It first checks that a finished build on the channel has this checkout's
// runtime fingerprint, since no other build would ever load the update.
// `--without-build` skips that, for publishing ahead of a build.
//
// The channel decides three things that must match the installed build:
// - APP_VARIANT: app.config.ts picks the bundle ID and scheme from it, and
//   the runtime fingerprint includes them. Without it the update resolves to
//   the development variant and no preview or production build accepts it.
// - `--environment`: EXPO_PUBLIC_* values are inlined at publish time; a bare
//   publish would bake in this machine's .env.local.
// - The maps come from the exact `dist/` just published; never rebuild in
//   between, or the debug IDs no longer match.
//
// Production refuses to publish without SENTRY_AUTH_TOKEN. Preview publishes
// without it and says so, so the pipeline can be tried without the token.
import { spawnSync } from "node:child_process";
import { appRoot, fingerprint, PLATFORMS } from "./fingerprint.mjs";

const CHANNELS = ["preview", "production"];

const [channel, ...rest] = process.argv.slice(2);
if (!CHANNELS.includes(channel)) {
	console.error(
		`Usage: publish-update.mjs <${CHANNELS.join("|")}> [--upload-only] [--without-build] [eas update args]`,
	);
	process.exit(1);
}
const OWN_FLAGS = ["--upload-only", "--without-build"];
const uploadOnly = rest.includes("--upload-only");
const withoutBuild = rest.includes("--without-build");
const easArgs = rest.filter((arg) => !OWN_FLAGS.includes(arg));
const upload = Boolean(process.env.SENTRY_AUTH_TOKEN);

if (!upload) {
	const message = "SENTRY_AUTH_TOKEN is not set, so source maps cannot be uploaded.";
	if (channel === "production" || uploadOnly) {
		console.error(`${message} Refusing to continue.`);
		process.exit(1);
	}
	console.warn(`${message} Publishing to ${channel} without them.`);
}

const env = {
	...process.env,
	APP_VARIANT: channel,
	// Same project as the @sentry/react-native plugin in app.json.
	SENTRY_ORG: "replace-sentry-org",
	SENTRY_PROJECT: "replace-sentry-project",
};

function run(command, args) {
	const result = spawnSync("pnpm", ["exec", command, ...args], {
		cwd: appRoot,
		env,
		stdio: "inherit",
	});
	if (result.error) console.error(result.error.message);
	if (result.status !== 0) {
		if (command !== "eas") {
			console.error(
				"The update is published but its maps are not. Re-run with --upload-only; don't publish again.",
			);
		}
		process.exit(result.status || 1);
	}
}

/** Whether a finished build on this channel and platform has `runtime`. */
function hasBuild(platform, runtime) {
	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"eas",
			"build:list",
			"--channel",
			channel,
			"--platform",
			platform,
			"--runtime-version",
			runtime,
			"--status",
			"finished",
			"--limit",
			"1",
			"--json",
			"--non-interactive",
		],
		{ cwd: appRoot, env, encoding: "utf8" },
	);
	if (result.status !== 0) {
		console.error(result.stderr);
		process.exit(result.status || 1);
	}
	return JSON.parse(result.stdout).length > 0;
}

if (!uploadOnly && !withoutBuild) {
	const found = PLATFORMS.map((platform) => {
		const runtime = fingerprint(channel, platform).hash;
		const ok = hasBuild(platform, runtime);
		console.log(
			`${platform}: runtime ${runtime.slice(0, 12)}, ${ok ? "a build has it" : "no build has it"}`,
		);
		return ok;
	});
	if (!found.some(Boolean)) {
		console.error(
			`No finished ${channel} build has this runtime, so no installed app would load the update. Build first (native code or config changed), or pass --without-build to publish anyway.`,
		);
		process.exit(1);
	}
}

if (!uploadOnly) {
	run("eas", ["update", "--channel", channel, "--environment", channel, ...easArgs]);
}
if (upload) run("sentry-expo-upload-sourcemaps", ["dist"]);
