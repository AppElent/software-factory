import { cn } from "./utils";

export function AuthError({
	message,
	className,
}: {
	message: string | null;
	className?: string;
}) {
	if (!message) {
		return null;
	}
	return (
		<p
			role="alert"
			className={cn(
				"rounded-[var(--auth-radius)] bg-[var(--auth-error)]/10 px-3 py-2 text-sm text-[var(--auth-error)]",
				className,
			)}
		>
			{message}
		</p>
	);
}
