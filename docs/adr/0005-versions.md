# Each version runs from its own folder

Status: accepted, 2026-11-07

Improve yourself can change the app that's running it, so a bad change must not leave you without the tool you'd use to fix it.

The service runs `releases/current`, a symlink to a folder named after a commit. A new commit gets its own clone, install and build, then starts on a spare port with sample data. Only then is it offered. Pressing `Update` moves the symlink and exits, and launchd starts whatever the symlink points at.

Getting a version ready runs its code before you press `Update`, because the build and the trial start both do. Install scripts and pnpmfiles are skipped, and every step gets no tokens and a throwaway home folder. That limits what a bad commit can reach, but it isn't a sandbox: code that knows where to look can still read your files. So a commit gets here only with green checks, and a merging mode can't merge changes to `package.json`, the lockfile, `.npmrc` or `scripts/` on this repo. Any other file a merging mode merges still runs here before you press `Update`.

A detached guard watches the switch from outside the service. It runs in its own process group, because launchd kills the service's group when the service exits. It expects `/api/version` to report the new commit within 90 seconds. If it doesn't, the guard moves the symlink back, marks the version failed, and restarts the service.

Updating stays a button. It only happens on its own once rollback has proven itself on real updates, and that's a later decision.

Migrations stay additive, so going back never needs a database backup. Losing the database is also cheap, see [0004](0004-portable-by-default.md).

Considered:

- **Running from the checkout and pulling.** The service would run whatever you were editing, a failed build leaves nothing to run, and going back means git commands in a folder you might be working in.
- **A watchdog inside the app.** It can't act when the app fails to start, which is the case that matters.
