---
type: standard
kind: platform
description: Read before implementing or reviewing native mobile code.
version: 1.4.0
applies_to: [mobile]
---

# Mobile coding

Native code separates routes, features, and app-wide UI, and gives each editing task one draft owner.

## Rules

- Routes, features, app-wide UI, and file names follow [mobile structure](mobile-structure.md). Views, editors, draft ownership, and page or sheet presentation follow [editors](editors.md). Reuse content and state when only the presentation changes; use separate wrappers when navigation or composition differs.

## Implementation

Expo Router and React Native traps that fail silently or only on device:

- **Sheet stacking:** presenting a routed sheet from inside a React Native `Modal` dismisses the `Modal`. Make the parent a routed screen, or keep the follow-up inside the `Modal`.
- **Header options identity:** a `Stack.Screen options={{…}}` literal is a new object every render; with `unstable_header*Items` it re-renders the screen and loops ("Maximum update depth exceeded"). Memoize the options object.
- **Discard guards:** dispatching the blocked action from inside a `usePreventRemove` callback is blocked again. Lift the guard (state or ref) first, then dispatch.
- **Hidden headers:** `headerShown: false` in a `_layout` hides any header the screen configures with `Stack.Screen`. Set `headerShown` per screen when screens draw their own.
- **Local files:** React Native does not implement the `file://` scheme in `fetch`. `fetch(uri)` on a local file returns a tiny "File not found" body that then uploads as a valid but corrupt file. Read local files with `expo-file-system`; `File(uri).upload()` also sets the exact `Content-Type` an upload endpoint may demand, where an empty one is rejected.
- **Babel-gated packages:** `babel-preset-expo` turns on some transforms only when the package is installed, for example the `'widget'` directive of `expo-widgets`. It decides this once per Metro cache. After installing such a package, restart Metro with `--clear`. Otherwise the code runs untransformed, and `createLiveActivity` fails with "Conversion from JavaScript value of type 'function' to native 'String' failed".
- **Live Activities:** a Live Activity left by an earlier launch survives a restart. Take it over with `getInstances()` before calling `start`, or the Lock Screen shows two. iOS starts an activity only from the foreground. Background updates (for example, from a location task) can only update one that is already running. Throttle updates, but keep the last one: schedule it for the end of the interval, because a value that stops changing produces no further event.
