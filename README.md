# Software Factory

A local control room for one developer's GitHub repos. Work orders move from Intake to Observe, agents do the work in T3, and you approve it.

More in the [build companion](designs/control-room/control-room_final.md), the [behaviour contract](docs/contracts/factory.md), and the [docs index](docs/README.md).

## Requirements

- macOS
- Node 26
- pnpm
- `gh`, signed in, and `t3`
- Optional: `sentry` for production errors, `terminal-notifier` for notifications

## Run

```sh
pnpm install
pnpm build
pnpm service:install
```

This installs a launchd agent on `http://127.0.0.1:4310`. It starts at login and restarts if it stops. `pnpm service:uninstall` removes the agent and leaves your data alone.

To look around with sample data, run `pnpm demo` after `pnpm build`. It serves on port 4311, keeps its data in `.scratch/demo`, and calls no real service.

## Check

| Command          | Runs                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pnpm check`     | Biome                                                                                  |
| `pnpm typecheck` | TypeScript                                                                             |
| `pnpm test`      | Vitest                                                                                 |
| `pnpm test:e2e`  | Browser checks against the demo. Needs `pnpm build` and Playwright's headless Chromium |

## Stop using it

`pnpm service:uninstall`, then delete the data folder. Threads stay in T3, PRs and issues on GitHub, and your settings, modes, environments and project list in the config file. Start it again later and it restores projects from that file and picks up running work from T3. The contract's Leaving section has the details.

## Private config

Nothing private lives in this repo. `~/Library/Application Support/Software Factory/` holds:

- `factory.db`, the database
- `session-token`, the per-install token
- `never-touch.json`, a JSON array of glob rules, such as `["client-*", "example-org/*"]`. If the file is broken, the service won't start
