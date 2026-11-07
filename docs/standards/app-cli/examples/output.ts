export function formatJson(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

export function formatTable<T extends Record<string, unknown>>(
	rows: T[],
	columns: Array<keyof T & string>,
): string {
	if (rows.length === 0) return "No results.\n";

	const widths = columns.map((column) =>
		Math.max(
			column.length,
			...rows.map((row) => String(row[column] ?? "").length),
		),
	);
	const header = columns
		.map((column, index) => column.padEnd(widths[index]))
		.join("  ");
	const separator = widths.map((width) => "-".repeat(width)).join("  ");
	const body = rows
		.map((row) =>
			columns
				.map((column, index) => String(row[column] ?? "").padEnd(widths[index]))
				.join("  "),
		)
		.join("\n");

	return `${header}\n${separator}\n${body}\n`;
}

export function formatDetail(entries: Record<string, unknown>): string {
	return `${Object.entries(entries)
		.map(([key, value]) => `${key}: ${String(value ?? "")}`)
		.join("\n")}\n`;
}
