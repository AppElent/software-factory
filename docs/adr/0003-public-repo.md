---
type: decision
description: Read when adding sample data, config, or anything personal to this repo.
version: 1.0.0
status: accepted
date: 2026-11-06
---

# Public repo, private config

The code and designs live in a public `software-factory` repo. Personal config and data stay on this Mac, outside the repo.

## Why

The owner chose public on 2026-11-05, and nothing in the code needs secrecy. Never-touch rules, however, would name private work if they were committed.

## Consequences

- Never-touch rules, project policy, and the database live in `~/Library/Application Support/Software Factory/`.
- Designs and tests use public repo names or generic ones such as `client-*`.
- Planning notes with private detail stay out of the repo.
- Reversing this later means a history scrub, so check before each first push of new material.
