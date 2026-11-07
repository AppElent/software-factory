---
type: standard
kind: capability
description: Read when adding or changing an application's user-facing command-line interface or its browser login.
version: 2.0.0
applies_to: [web, backend]
---

# Application CLI

An app's CLI is app-owned source with a safe loopback browser login and credentials that never leak into output.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- The CLI is application code in `cli/`, separate from toolkit scripts. No `@appelent/cli` dependency; copied runtime helpers become app-owned.
- Commands are thin: API/Convex calls and authorization stay in application services.
- JSON and config output redact credentials. Never log credential-bearing callback URLs or include tokens in issue reports.
- Browser login uses a loopback callback with unpredictable `state`. The backend authenticates the user and validates the redirect scheme, loopback host, callback path, and port policy, so login cannot redirect or leak tokens elsewhere. The callback rejects a wrong `state` and reports denial and timeouts.
- The config directory follows the app name and honors an `<APPNAME>_CONFIG_DIR` override; tests use a temporary directory.
- **Default:** run with the app's existing `tsx` runner or TypeScript build. Do not publish a package just to get a repository-local command.

Token transport in a URL and file-based credential storage are inherited behavior; review them before distributing the CLI more widely. They are not an OAuth implementation.

## Implementation

1. Copy the [runtime examples](app-cli/examples/index.ts) and their sibling files and commands into `cli/runtime/`.
2. Add a thin entry and a package script (`"my-app": "tsx cli/index.ts"`):

```ts
import { createCli } from './runtime/index';
const { runCli } = createCli({ appName: 'my-app' });
const result = await runCli(process.argv.slice(2), {
  writeOut: value => process.stdout.write(value),
  writeErr: value => process.stderr.write(value),
  env: process.env,
});
process.exitCode = result.exitCode;
```

3. Register domain commands through the `commands` option. The built-in `auth` and `config` commands handle local configuration, token status, and browser login against the app's `/api/cli/auth/login`.

## Verify

- Smoke: help, redacted config output, and auth status, without personal credentials.
- Against a local fixture backend: login success, wrong state, backend error, timeout, and launcher failure.
- In GitHub Actions, set a `runner.temp`-based config override on the step, not as a job-level env expression.

## Migration

Replaces `features/app-cli`. Inventory `@appelent/cli` imports and copy the matching tested helpers and command wiring into `cli/`. Preserve the app name, config location, backend contract, and user-visible commands. Test before removing the package.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
