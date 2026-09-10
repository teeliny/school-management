/**
 * Fires a best-effort beacon to /api/client-error so a caught client-side
 * exception leaves a trace in server logs instead of only existing in a
 * device console nobody can see (the school's users are on remote phones,
 * not a debuggable machine). Never throws — a broken error reporter must not
 * itself become the next crash.
 */
export function reportClientError(error: Error & { digest?: string }) {
  try {
    const payload = JSON.stringify({
      message: error.message?.slice(0, 500),
      stack: error.stack?.slice(0, 2000),
      digest: error.digest,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/client-error", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(
        () => {},
      );
    }
  } catch {
    // reporting must never throw
  }
}
