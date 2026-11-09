# Durable things live outside the database

Status: accepted, 2026-11-07

Stopping this app shouldn't cost much. So anything you'd miss lives where it keeps working without the app: T3 for agents and automations, GitHub for code, Sentry for errors, and a plain JSON file for configuration. The database holds what can be read again, plus history.

The test is concrete: delete the data folder and restart. `tests/server/portable.test.ts` does this. You lose finished work orders, deploy history, the audit log, metrics, dismissals and snoozes.

Work picked up from T3 merges only when you do. Its original mode isn't recorded in T3, so assuming one that merges on its own would be guessing with your production.

Considered: keeping a database backup in the config folder. It keeps everything, but the app is still required to read it, which misses the point.
