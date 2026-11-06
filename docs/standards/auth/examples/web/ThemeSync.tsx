import { useUser } from "@clerk/react";
import { useEffect } from "react";
import {
	applyThemeMode,
	getInitialMode,
	reconcileTheme,
	setThemeMode,
} from "./theme";

/**
 * On sign-in, reconcile the theme stored in Clerk unsafeMetadata with
 * localStorage. localStorage stays the pre-paint source (no FOUC); Clerk is the
 * cross-device canonical store. Renders nothing.
 */
export function ThemeSync() {
	const { isLoaded, isSignedIn, user } = useUser();

	useEffect(() => {
		if (!isLoaded || !isSignedIn || !user) {
			return;
		}
		const next = reconcileTheme(user.unsafeMetadata?.theme, getInitialMode());
		if (next) {
			setThemeMode(next);
		} else {
			applyThemeMode(getInitialMode());
		}
	}, [isLoaded, isSignedIn, user]);

	return null;
}
