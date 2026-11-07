export type ThemeMode = "light" | "dark" | "auto";

export function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") {
		return "auto";
	}

	const stored = window.localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}

	return "auto";
}

export function applyThemeMode(mode: ThemeMode) {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;

	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(resolved);

	if (mode === "auto") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", mode);
	}

	document.documentElement.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode) {
	applyThemeMode(mode);
	window.localStorage.setItem("theme", mode);
}

function isThemeMode(value: unknown): value is ThemeMode {
	return value === "light" || value === "dark" || value === "auto";
}

/**
 * Given the theme stored in Clerk metadata and the current local mode, return
 * the mode to apply, or null if nothing should change. Pure — no DOM/storage.
 */
export function reconcileTheme(
	clerkTheme: unknown,
	localTheme: ThemeMode,
): ThemeMode | null {
	if (!isThemeMode(clerkTheme)) {
		return null;
	}
	return clerkTheme === localTheme ? null : clerkTheme;
}

/**
 * Pre-paint script (inline in the document <head>) that applies the stored
 * theme before React hydrates, preventing a flash of unstyled content.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;
