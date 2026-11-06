import { useEffect } from "react";

export function PwaRegistration() {
	useEffect(() => {
		if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
		navigator.serviceWorker.register("/sw.js").catch(() => {
			// Non-fatal: the application remains usable without installation support.
		});
	}, []);
	return null;
}
