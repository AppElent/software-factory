export type NativeOtaSelection = {
	profile: string;
	environment: string;
	channel: string;
	/** A resolved runtime fingerprint/version from the selected EAS build. */
	runtimeVersion: string;
};

export type NativeOtaGuardOptions = {
	expectedProfile: string;
	expectedEnvironment: string;
	expectedChannel: string;
	/** The runtime fingerprint/version recorded by the existing native binary. */
	nativeRuntimeVersion: string;
};

export type NativeOtaGuardResult =
	| { ok: true; selection: NativeOtaSelection; resolvedRuntimeVersion: string }
	| { ok: false; code: string; message: string };

function isResolvedRuntimeVersion(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized.length > 0 &&
		normalized !== "fingerprint" &&
		normalized !== "policy" &&
		normalized !== "fingerprint-policy"
	);
}

/**
 * Fail closed until the caller supplies evidence from the actual native binary.
 * This pure helper does not query EAS or calculate an Expo fingerprint.
 */
export function validateNativeOtaRelease(
	selection: NativeOtaSelection,
	options: NativeOtaGuardOptions,
): NativeOtaGuardResult {
	const pairs: Array<[keyof NativeOtaSelection, string]> = [
		["profile", options.expectedProfile],
		["environment", options.expectedEnvironment],
		["channel", options.expectedChannel],
	];
	for (const [key, expected] of pairs) {
		if (!selection[key] || selection[key] !== expected) {
			return {
				ok: false,
				code: `${key}-mismatch`,
				message: `${key} must be ${expected} for this OTA release`,
			};
		}
	}
	if (!isResolvedRuntimeVersion(options.nativeRuntimeVersion)) {
		return {
			ok: false,
			code: "native-runtime-unresolved",
			message:
				"OTA requires the installed native binary runtime fingerprint/version",
		};
	}
	if (!isResolvedRuntimeVersion(selection.runtimeVersion)) {
		return {
			ok: false,
			code: "selected-runtime-unresolved",
			message:
				"OTA requires a resolved runtime fingerprint/version from the selected build",
		};
	}
	if (selection.runtimeVersion !== options.nativeRuntimeVersion) {
		return {
			ok: false,
			code: "runtime-mismatch",
			message: "OTA runtime version does not match the selected native binary",
		};
	}
	return {
		ok: true,
		selection,
		resolvedRuntimeVersion: selection.runtimeVersion,
	};
}
