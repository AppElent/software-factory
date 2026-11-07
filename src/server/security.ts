import type { MiddlewareHandler } from "hono";

export const SESSION_HEADER = "x-sf-session";

export const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	// Radix's scroll lock injects a style tag.
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self'",
	"img-src 'self' data:",
	"connect-src 'self'",
	"base-uri 'none'",
	"form-action 'self'",
	"frame-ancestors 'none'",
].join("; ");

const allowedHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];
const allowedOrigins = (port: number) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

/** ADR 0001: refuse a wrong Host or Origin everywhere, and a mutation without the session header. */
export function guard(opts: { port: number; token: string; devOrigins?: string[] }): MiddlewareHandler {
	const hosts = allowedHosts(opts.port);
	const origins = [...allowedOrigins(opts.port), ...(opts.devOrigins ?? [])];
	return async (c, next) => {
		const host = c.req.header("host") ?? "";
		if (!hosts.includes(host)) return c.text("Wrong host", 403);
		const origin = c.req.header("origin");
		if (origin !== undefined && !origins.includes(origin)) return c.text("Wrong origin", 403);
		const safe = c.req.method === "GET" || c.req.method === "HEAD";
		if (!safe && c.req.header(SESSION_HEADER) !== opts.token) return c.text("Missing session", 403);
		// Other sites can link to the page, but can't call the API.
		const site = c.req.header("sec-fetch-site");
		if (
			c.req.path.startsWith("/api/") &&
			site &&
			site !== "same-origin" &&
			site !== "none" &&
			!opts.devOrigins?.length
		)
			return c.text("Wrong site", 403);
		await next();
		c.header("Content-Security-Policy", CSP);
		c.header("X-Content-Type-Options", "nosniff");
		c.header("Referrer-Policy", "no-referrer");
		c.header("X-Frame-Options", "DENY");
	};
}
