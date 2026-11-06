---
type: decision
description: Read when changing where the factory runs, what it stores, or how the browser reaches it.
version: 1.0.0
status: accepted
date: 2026-11-06
---

# Local service with SQLite

The factory is one Node process under launchd on `127.0.0.1:4310`, with a Hono API, SSE to a Vite React app, and SQLite through `node:sqlite` at `~/Library/Application Support/Software Factory/factory.db`.

## Why

It runs on one Mac for one person, and work must continue with the browser closed, which rules out a browser-only app. One process needs no queue or separate database. Webhooks can't reach localhost without a tunnel, so it polls outward.

GitHub, Sentry, and git stay the source of truth. SQLite holds triage, work orders, and history, so losing it loses those but no project data.

## Consequences

A localhost service holding CLI logins and able to start agents is a real target, so these are required:

- Bind to loopback only. Validate `Host` and `Origin`. No CORS. A per-install session token, a custom header on mutations, and a strict CSP.
- Store no secrets and send none to the browser. Use each CLI's own login. Scrub logs.
- Treat text from repos, issues, PRs, comments, and Sentry as untrusted data, never instructions. A worktree isolates files, not credentials, so agents get no production secrets by default.

It works only while the Mac is awake. Going beyond this Mac means revisiting this decision.
