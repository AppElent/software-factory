import { useEffect, useRef } from "react";

/** Single-letter keys do nothing while focus is in an input, textarea, select, or dialog. */
export function typing(e: KeyboardEvent): boolean {
	const el = e.target as HTMLElement | null;
	if (!el) return false;
	if (el.closest("input, textarea, select, [contenteditable=true]")) return true;
	return !!el.closest('[role="dialog"], [role="alertdialog"], [cmdk-root]');
}

/** Binds single-letter keys for the life of a component. `keys` is `{ j: () => …, Enter: () => … }`. */
export function useKeys(keys: Record<string, (e: KeyboardEvent) => void>) {
	const ref = useRef(keys);
	ref.current = keys;
	useEffect(() => {
		const on = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
			const fn = ref.current[e.key];
			if (fn) fn(e);
		};
		window.addEventListener("keydown", on);
		return () => window.removeEventListener("keydown", on);
	}, []);
}
