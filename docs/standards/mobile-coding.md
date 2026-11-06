---
type: standard
kind: platform
description: Read before implementing or reviewing native mobile code.
version: 1.3.0
applies_to: [mobile]
---

# Mobile coding

Native code separates routes, features, and app-wide UI, and gives each editing task one draft owner.

## Rules

- Routes own parameter validation, navigation, and presentation. Feature modules own screens, state, and domain-aware supporting UI. App-wide UI owns domain-independent controls and platform adapters; it must not import features. Shared domain calculations belong in a workspace module when web/backend/native callers need them.
- Keep supporting UI within the smallest feature/subject that uses its contract. Move it outward when another subject needs that contract. Keep state hooks beside their owner, paired tests beside the component, and scenario tests in the subject's `__tests__/`. Use kebab-case filenames with subject/task/role names and matching PascalCase component exports; retain complete basenames for platform/test variants.
- A view reads saved data. An editor owns a draft, validation, and commit. A page or sheet is a presentation of that task. Reuse content and state when only the presentation changes; separate wrappers when navigation or composition differs. Instantiate draft state once per editing session. Two calls to the same hook do not share a draft.
- Routed sheets represent navigable tasks; local sheets/popups support the current task. Give keyboard geometry, scrolling, safe areas, and dismissal a coordinating owner. Apply the same unsaved-change policy to close, swipe dismissal, and Android Back. Read the [editors pattern](editors.md) when choosing the UI.

## Implementation

Expo Router and React Native traps that fail silently or only on device:

- **Sheet stacking:** presenting a routed sheet from inside a React Native `Modal` dismisses the `Modal`. Make the parent a routed screen, or keep the follow-up inside the `Modal`.
- **Header options identity:** a `Stack.Screen options={{…}}` literal is a new object every render; with `unstable_header*Items` it re-renders the screen and loops ("Maximum update depth exceeded"). Memoize the options object.
- **Discard guards:** dispatching the blocked action from inside a `usePreventRemove` callback is blocked again. Lift the guard (state or ref) first, then dispatch.
- **Hidden headers:** `headerShown: false` in a `_layout` hides any header the screen configures with `Stack.Screen`. Set `headerShown` per screen when screens draw their own.
- **Local files:** React Native does not implement the `file://` scheme in `fetch`. `fetch(uri)` on a local file returns a tiny "File not found" body that then uploads as a valid but corrupt file. Read local files with `expo-file-system`; `File(uri).upload()` also sets the exact `Content-Type` an upload endpoint may demand, where an empty one is rejected.
- **Babel-gated packages:** `babel-preset-expo` turns on some transforms only when the package is installed, for example the `'widget'` directive of `expo-widgets`. It decides this once per Metro cache. After installing such a package, restart Metro with `--clear`. Otherwise the code runs untransformed, and `createLiveActivity` fails with "Conversion from JavaScript value of type 'function' to native 'String' failed".
- **Live Activities:** a Live Activity left by an earlier launch survives a restart. Take it over with `getInstances()` before calling `start`, or the Lock Screen shows two. iOS starts an activity only from the foreground. Background updates (for example, from a location task) can only update one that is already running. Throttle updates, but keep the last one: schedule it for the end of the interval, because a value that stops changing produces no further event.

## Verify

- Mechanical checks enforce only the boundaries they can observe. Review semantic ownership and cross-file consistency separately.

## Exceptions

Project standards identify actual directories and gradual migration boundaries. Record deviations in `CODING_STANDARDS.md`: rule, scope, replacement, reason.
