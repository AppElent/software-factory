/** The only way the page talks to the service. Every mutation carries the session header. */

export class ApiFailure extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

type Listener = () => void;
const listeners = new Set<Listener>();
let offline = false;
let staleBuild = false;

export const connection = {
	subscribe(l: Listener) {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	offline: () => offline,
	staleBuild: () => staleBuild,
	setOffline(next: boolean) {
		if (offline === next) return;
		offline = next;
		for (const l of listeners) l();
	},
	setStaleBuild(next: boolean) {
		if (staleBuild === next) return;
		staleBuild = next;
		for (const l of listeners) l();
	},
};

const meta = (name: string) =>
	document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;

let token: string | null = meta("sf-session");
export const pageBuild = () => meta("sf-build");

async function sessionToken(): Promise<string> {
	if (token) return token;
	// Only the Vite dev server gets here: the built page has the token in a meta tag.
	const res = await fetch("/api/session");
	const body = (await res.json()) as { token: string };
	token = body.token;
	return token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const headers: Record<string, string> = {};
	if (method !== "GET") headers["x-sf-session"] = await sessionToken();
	if (body !== undefined) headers["content-type"] = "application/json";
	let res: Response;
	try {
		res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	} catch {
		connection.setOffline(true);
		throw new ApiFailure("The service isn't reachable.", 0);
	}
	connection.setOffline(false);
	const text = await res.text();
	let parsed: unknown = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		// Not JSON, such as a guard refusal. The status says enough.
	}
	if (!res.ok) {
		const message = (parsed as { error?: string } | null)?.error ?? text ?? "Something went wrong.";
		throw new ApiFailure(message, res.status);
	}
	return parsed as T;
}

export const api = {
	get: <T>(path: string) => request<T>("GET", path),
	post: <T = { ok: boolean }>(path: string, body: unknown = {}) => request<T>("POST", path, body),
	put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
};
