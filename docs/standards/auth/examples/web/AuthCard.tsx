import { cn } from "./utils";
import { useAuthConfig } from "./AuthConfigProvider";
import type { SlotClassNames } from "./types";

export function AuthCard({
	title,
	subtitle,
	children,
	classNames,
}: {
	title: string;
	subtitle?: string;
	children: React.ReactNode;
	classNames?: SlotClassNames<"root" | "card" | "header">;
}) {
	const config = useAuthConfig();
	return (
		<div
			className={cn(
				"flex min-h-screen items-center justify-center bg-[var(--auth-bg)] p-4",
				classNames?.root,
			)}
		>
			<div
				className={cn(
					"w-full max-w-sm rounded-[var(--auth-radius)] border border-[var(--auth-border)] bg-[var(--auth-card-bg)] p-6 shadow-sm",
					classNames?.card,
				)}
			>
				<div className={cn("mb-5 text-center", classNames?.header)}>
					{config.logo ?? (
						<span className="text-base font-semibold text-[var(--auth-fg)]">
							{config.appName}
						</span>
					)}
					<h1 className="mt-2 text-lg font-semibold text-[var(--auth-fg)]">
						{title}
					</h1>
					{subtitle ? (
						<p className="mt-1 text-sm text-[var(--auth-muted)]">{subtitle}</p>
					) : null}
				</div>
				{children}
			</div>
		</div>
	);
}
