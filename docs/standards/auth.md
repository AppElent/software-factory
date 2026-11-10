---
type: standard
kind: capability
description: Read when adding or changing Clerk/Convex authentication, session readiness, or account flows.
version: 3.1.0
applies_to: [web, mobile, backend]
---

# Authentication

Clerk owns sessions and navigation; Convex verifies tokens and gates every protected read and write.

## Rules

- Navigation, provisioning, sign-out cleanup, theming, and credential routing stay app-owned. Never put login credentials in public build variables.

### Session readiness and protected data

- On web and native, navigation follows loaded Clerk session state; protected data follows Convex. Clerk's isSignedIn/userId does not establish backend readiness. Never redirect solely because Convex authentication is pending ([Convex's startup-race guidance](https://docs.convex.dev/auth/debug)).
- Keep ClerkProvider and ConvexProviderWithClerk mounted above the data gate. Mount protected query providers and screens only beneath an Authenticated component or a gate checking useConvexAuth().isAuthenticated. Hooks in the gate itself or ancestors remain unprotected.
- Outside that boundary, pass "skip" to protected useQuery/usePaginatedQuery calls until Convex authenticates. Guard imperative queries, mutations, and actions separately and handle rejections.
- Distinguish pending authentication from failure using isLoading and app-owned recovery behavior. After bounded waiting, reveal recovery controls; never use elapsed time to authorize requests or leave an indefinite blank screen. Normal token refresh need not make isAuthenticated false.
- Authentication loss unmounts gated children. Choose the boundary deliberately; preserve drafts according to app policy and clear or partition account-specific state on logout/account switching.
- Recover from throwing query hooks with an error boundary. Retain server identity and resource-permission checks on every protected operation; gating cannot guarantee later calls succeed.

### Account flows

- Use supported Clerk UI or custom flows covering verification, MFA, password reset, incomplete sessions, and activation/finalization. A successful password request is not a completed session. Preserve failed input, prevent duplicate submissions, and translate provider codes.

## Implementation

### Web wiring

Follow [Convex's Clerk integration](https://docs.convex.dev/auth/clerk). Validate public configuration through the app's environment schema; keep server keys server-only. For @clerk/react (Clerk Core 3) apps:

```tsx
import { ClerkProvider, useAuth } from '@clerk/react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';

const convex = new ConvexReactClient(publicConvexUrl);
// publicClerkKey/publicConvexUrl come from app-validated public configuration.
<ClerkProvider publishableKey={publicClerkKey}>
  <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
    <App />
  </ConvexProviderWithClerk>
</ClerkProvider>;
```

Use the installed SDK's adapter; preserve its generation and app-specific router options.

### Web account UI

For @clerk/react (Clerk Core 3) custom flows, copy the [web examples](auth/examples/web/index.ts) and their siblings into an app-owned directory; the index header lists what they provide and need. Import [tokens.css](auth/examples/web/tokens.css) from the app stylesheet, map its `--auth-*` variables onto the app palette, and add the [env typings](auth/examples/web/vite-env.d.ts) unless the app already declares those keys. Routes, labels, and branding stay app-owned through `AuthConfigProvider` and component props.

### Native and headless behavior

Copy needed [native helper](auth/examples/native.ts) behavior into app-owned code. Use the installed @clerk/expo version's official token cache and session finalization.

## Verify

Verify zero protected requests while Clerk is signed in and Convex is delayed, including provider-level subscriptions. Test authentication gained/lost/regained, account switching, draft handling, stalled-handshake recovery without redirect loops, new/existing accounts, incomplete/MFA flows, expired sessions, and unauthorized calls. Exercise cold launch and background/resume on a native device/build; report runtime verification separately from helper tests.
