export function RouteErrorFallback({
  reset,
  title = "Something went wrong",
  message = "Please try again.",
  retryLabel = "Try again",
}: {
  error?: Error;
  reset: () => void;
  title?: string;
  message?: string;
  retryLabel?: string;
}) {
  // Supply translated, app-approved copy; never display arbitrary server error messages.
  return (
    <section role="alert">
      <h1>{title}</h1>
      <p>{message}</p>
      <button type="button" onClick={reset}>{retryLabel}</button>
    </section>
  );
}
