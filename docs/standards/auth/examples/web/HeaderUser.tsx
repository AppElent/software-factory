import { Show, useClerk, useUser } from "@clerk/react";
import { useEffect, useId, useRef, useState } from "react";
import { useAuthConfig } from "./AuthConfigProvider";
import { cn } from "./utils";

// Disclosure pattern: a toggle button that reveals account links/actions.
// Escape, outside clicks, and focus leaving close it; Escape refocuses the trigger.
export default function HeaderUser() {
	const { user } = useUser();
	const { signOut } = useClerk();
	const config = useAuthConfig();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelId = useId();
	const initials = (
		user?.firstName?.[0] ??
		user?.primaryEmailAddress?.emailAddress?.[0] ??
		"?"
	).toUpperCase();

	useEffect(() => {
		if (!open) {
			return;
		}

		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		}
		function onPointerDown(e: PointerEvent) {
			if (!rootRef.current?.contains(e.target as Node)) {
				setOpen(false);
			}
		}

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open]);

	return (
		<>
			<Show when="signed-in">
				<div
					ref={rootRef}
					className="relative"
					onBlur={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget)) {
							setOpen(false);
						}
					}}
				>
					<button
						ref={triggerRef}
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--auth-accent)] text-sm font-medium text-[var(--auth-accent-fg)]"
						aria-label="Account menu"
						aria-expanded={open}
						aria-controls={panelId}
					>
						{initials}
					</button>
					<div
						id={panelId}
						hidden={!open}
						className={cn(
							"absolute right-0 mt-2 w-40 rounded-[var(--auth-radius)] border border-[var(--auth-border)] bg-[var(--auth-card-bg)] p-1 shadow-md",
						)}
					>
						<a
							href={config.paths.account}
							onClick={() => setOpen(false)}
							className="block rounded px-3 py-2 text-sm text-[var(--auth-fg)] hover:bg-[var(--auth-border)]"
						>
							Account
						</a>
						<button
							type="button"
							onClick={() => signOut()}
							className="block w-full rounded px-3 py-2 text-left text-sm text-[var(--auth-fg)] hover:bg-[var(--auth-border)]"
						>
							Sign out
						</button>
					</div>
				</div>
			</Show>
			<Show when="signed-out">
				<a
					href={config.paths.signIn}
					className="text-sm font-medium text-[var(--auth-fg)] hover:underline"
				>
					Sign in
				</a>
			</Show>
		</>
	);
}
