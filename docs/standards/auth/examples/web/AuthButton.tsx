import { cn } from "./utils";

export function AuthButton({
	children,
	loading,
	variant = "primary",
	type = "submit",
	onClick,
	className,
}: {
	children: React.ReactNode;
	loading?: boolean;
	variant?: "primary" | "ghost";
	type?: "submit" | "button";
	onClick?: () => void;
	className?: string;
}) {
	return (
		<button
			type={type}
			disabled={loading}
			aria-busy={loading ?? false}
			onClick={onClick}
			className={cn(
				"inline-flex items-center justify-center rounded-[var(--auth-radius)] px-4 py-2 text-sm font-medium transition disabled:opacity-60",
				variant === "primary"
					? "bg-[var(--auth-accent)] text-[var(--auth-accent-fg)] hover:opacity-90"
					: "border border-dashed border-[var(--auth-accent)] text-[var(--auth-fg)] hover:bg-[var(--auth-border)]",
				className,
			)}
		>
			{loading ? "Please wait…" : children}
		</button>
	);
}
