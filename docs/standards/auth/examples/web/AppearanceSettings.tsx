import { useUser } from "@clerk/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthConfig } from "./AuthConfigProvider";
import {
	applyThemeMode,
	getInitialMode,
	setThemeMode,
	type ThemeMode,
} from "./theme";
import { cn } from "./utils";

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
	{ mode: "light", label: "Light", icon: Sun },
	{ mode: "auto", label: "Auto", icon: Monitor },
	{ mode: "dark", label: "Dark", icon: Moon },
];

export function AppearanceSettings() {
	const [mode, setMode] = useState<ThemeMode>("auto");
	const { user } = useUser();
	const { appName } = useAuthConfig();

	useEffect(() => {
		setMode(getInitialMode());
	}, []);

	useEffect(() => {
		if (mode !== "auto") {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyThemeMode("auto");

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, [mode]);

	function selectMode(next: ThemeMode) {
		setMode(next);
		setThemeMode(next);
		if (user) {
			user
				.update({ unsafeMetadata: { ...user.unsafeMetadata, theme: next } })
				.catch(() => {
					// non-fatal: local theme already applied
				});
		}
	}

	return (
		<section className="rm-panel p-4">
			<p className="rm-label">Appearance</p>
			<p className="mt-1 text-sm text-neutral-500">
				Choose how {appName} looks. Auto follows your system setting.
			</p>
			<div className="mt-3 inline-flex gap-1 rounded-md border border-neutral-200 p-1">
				{OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => (
					<button
						key={optionMode}
						type="button"
						onClick={() => selectMode(optionMode)}
						aria-pressed={mode === optionMode}
						className={cn(
							"flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition",
							mode === optionMode
								? "bg-neutral-900 text-white"
								: "text-neutral-600 hover:bg-neutral-100",
						)}
					>
						<Icon size={15} /> {label}
					</button>
				))}
			</div>
		</section>
	);
}
