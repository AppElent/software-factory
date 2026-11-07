---
type: standard
kind: capability
description: Read when adding or changing how users report a problem from inside the app.
version: 2.0.0
applies_to: [web, mobile]
---

# Issue reporting

Users report a problem in two taps or a shake, and the report lands in Sentry with the context to act on it.

## Rules

- Reports use Sentry User Feedback through the app's single Sentry initializer ([Sentry monitoring](sentry-monitoring.md)). No separate issue backend, token, or GitHub write from the client.
- Settings has a "Report a problem" row that opens the feedback form. When the form is unavailable (Sentry disabled, Expo Go), show a localized message instead of failing silently.
- Native apps enable shake to report. Web has no shake; the Settings row is its entry point.
- Form copy is localized and follows the app's language at runtime.
- Do not ask for name or email; the signed-in user is attached through Sentry's user context under the app's privacy policy.
- **Default:** screenshots are optional and user-controlled: users can take, pick, preview, and remove one before sending.
- Feedback events skip `beforeSend`. Redact report text with an event processor that handles `event.type === "feedback"` (or the SDK's `beforeSendFeedback` where it exists), never by relying on the error hooks.

## Implementation

1. Add `feedbackIntegration` to the existing `Sentry.init` integrations with shake to report on native, screenshot controls, and name/email hidden.
2. Expose a function that applies localized labels to the integration options; call it on locale change.
3. Add the Settings row and catch failures to show the localized fallback. React Native: `Sentry.showFeedbackForm()`. Web: `Sentry.getFeedback()`, then open its form (`createForm()`, `appendToDom()`, `open()` in current SDKs); confirm the call against the installed version.
4. Register the feedback redaction processor (`Sentry.addEventProcessor`) next to the initializer.
5. Attach a sanitized screen or route name if support needs to know where the form opened.

Screenshot, replay, and attachment detail: [Sentry setup](sentry-monitoring/setup.md#feedback-screenshots-and-replay-testing).

## Verify

- Unit test: the Settings row opens the form, and shows the fallback when opening throws.
- Unit test: the feedback processor redacts a secret in the message, and leaves non-feedback events to the error hooks.
- On a release-test build: shake opens the form, a report with a screenshot arrives in Sentry with environment, release, and user, and without name or email fields.
- Switching language changes the form copy.

## Migration

Replaces the GitHub-issue reporter (`features/issue-reporter`). Remove its server endpoint, `GITHUB_ISSUES_TOKEN`/`GITHUB_ISSUES_REPOSITORY` configuration, and form after the Sentry flow is verified. Keep the existing Settings route and copy where they fit.

## Exceptions

Record in `CODING_STANDARDS.md` or `DESIGN_SYSTEM.md`: rule, scope, replacement, reason.
