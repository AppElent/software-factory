import { useId } from "react";
import { cn } from "./utils";
import type { SlotClassNames } from "./types";

export function AuthField({
	label,
	type,
	value,
	onChange,
	error,
	autoComplete,
	required,
	classNames,
}: {
	label: string;
	type: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	autoComplete?: string;
	required?: boolean;
	classNames?: SlotClassNames<"root" | "label" | "input" | "error">;
}) {
	const id = useId();
	const errorId = useId();
	return (
		<div className={cn("flex flex-col gap-1", classNames?.root)}>
			<label
				htmlFor={id}
				className={cn(
					"text-sm font-medium text-[var(--auth-fg)]",
					classNames?.label,
				)}
			>
				{label}
			</label>
			<input
				id={id}
				type={type}
				value={value}
				required={required}
				autoComplete={autoComplete}
				aria-describedby={error ? errorId : undefined}
				onChange={(e) => onChange(e.target.value)}
				className={cn(
					"rounded-[var(--auth-radius)] border border-[var(--auth-border)] bg-[var(--auth-field-bg)] px-3 py-2 text-sm text-[var(--auth-fg)] outline-none focus:border-[var(--auth-accent)]",
					classNames?.input,
				)}
			/>
			{error ? (
				<p
					id={errorId}
					className={cn("text-xs text-[var(--auth-error)]", classNames?.error)}
				>
					{error}
				</p>
			) : null}
		</div>
	);
}
