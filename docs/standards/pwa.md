---
type: standard
kind: capability
description: Read when adding or changing a web app's manifest, installability, or service worker.
version: 2.0.0
applies_to: [web]
---

# Progressive Web App

An installable web app ships a real manifest and a post-build service worker that never caches runtime or authenticated data.

## Rules

Rules are required unless marked **Default** (replaceable with a recorded exception).

- PWA support is optional and browser-only; it does not make the native app ready. Confirm installability and offline-shell needs before adding a service worker.
- The manifest uses the real app name, theme, start URL, and production 192px, 512px, and maskable icons. Placeholder art is not release-ready.
- The service worker precaches build assets only. API, Convex, and authenticated traffic stay out of precache and runtime cache rules.
- Register the worker in production builds only, from browser-only code.
- Updates never silently discard unsaved input. When `skipWaiting`/`clientsClaim` could replace code mid-session, preserve input or prompt for a coordinated refresh.
- **Default:** generate the worker with post-build Workbox rather than a framework service-worker plugin. Revalidate against the real output structure when framework versions change.

## Implementation

1. Adapt the [manifest template](pwa/templates/manifest.webmanifest) and link it from the root document.
2. Copy [generate-sw.mjs](pwa/templates/generate-sw.mjs) into `scripts/`, add a compatible `workbox-build` dev dependency, and run it after the production client build. Point it at the actual client output directory.
3. Copy and mount [PwaRegistration](pwa/templates/PwaRegistration.tsx) in browser content.

## Verify

In a browser against the production build: manifest loads, icons resolve, worker scope is correct, the install flow works, refresh and update activation behave, and offline shows the shell without any authenticated data. Unregister old development workers before diagnosing stale pages.

## Migration

Replaces `features/pwa`. Compare existing manifest, worker generation, and registration; remove duplicate registrations or obsolete plugins deliberately. Never overwrite production artwork or delete an active worker without an upgrade or removal plan. Updating the template does not update an installed worker.

## Exceptions

Record in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
