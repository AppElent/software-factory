import { type ReactNode, useId } from "react";
export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	const titleId = useId();
	return (
		<section aria-labelledby={titleId}>
			<h2 id={titleId}>{title}</h2>
			{description ? <p>{description}</p> : null}
			{action}
		</section>
	);
}
