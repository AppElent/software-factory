/** Time and number words. Every age on screen goes through here. */

export function ago(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return "–";
	const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}

/** The same without "ago", for "Agent working · 6m". */
export function span(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return "–";
	const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}

export const clock = (iso: string | null | undefined) => {
	if (!iso) return "–";
	const d = new Date(iso);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const pct = (n: number | null | undefined) => (n == null ? "–" : `${n}%`);
export const minutes = (n: number | null | undefined) => {
	if (n == null) return "–";
	return n < 60 ? `${n}m` : `${Math.round(n / 60)}h`;
};

/** "Arcade Club, satisfactory, and roadmaps". */
export function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
