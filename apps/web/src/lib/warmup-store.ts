export type WarmupState = { status: "idle" } | { status: "warming"; startedAt: number };

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 120_000; // 90s countdown shown to the user + 30s slack before giving up
const WARM_CACHE_MS = 10_000; // collapses a burst of calls (e.g. several queries firing on page mount) into one check

let state: WarmupState = { status: "idle" };
const listeners = new Set<() => void>();
let waiters: Array<() => void> = [];
let pollTimer: ReturnType<typeof setTimeout> | null = null;
// Set synchronously (unlike pollTimer, which is only assigned after the
// first fetch resolves) so concurrent same-tick callers can't each start
// their own poll loop before the first one has a chance to claim it.
let polling = false;
let warmUntil = 0;
let inFlightCheck: Promise<boolean> | null = null;

function setState(next: WarmupState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): WarmupState {
  return state;
}

/**
 * Multiple concurrent callers hitting a cold API all call this — it's
 * idempotent about starting the poll loop and just queues onto `waiters`, so
 * one shared poll loop resolves all of them together once warm.
 */
export function waitUntilWarm(): Promise<void> {
  if (state.status === "idle") setState({ status: "warming", startedAt: Date.now() });
  if (!polling) {
    polling = true;
    poll();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function resolveAllAndReset() {
  const toResolve = waiters;
  waiters = [];
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  polling = false;
  warmUntil = Date.now() + WARM_CACHE_MS;
  setState({ status: "idle" });
  toResolve.forEach((resolve) => resolve());
}

async function poll() {
  if (state.status !== "warming") {
    polling = false;
    return;
  }
  try {
    const res = await fetch("/api/warmup-status", { cache: "no-store" });
    const body: { warm: boolean } = await res.json();
    if (body.warm) {
      resolveAllAndReset();
      return;
    }
  } catch {
    // transient polling failure — keep trying until MAX_WAIT_MS
  }
  if (Date.now() - state.startedAt > MAX_WAIT_MS) {
    resolveAllAndReset();
    return;
  }
  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

/**
 * Called by apiFetch/login BEFORE firing their real request, so a burst of
 * concurrent calls (e.g. a dashboard's several queries on mount) shares one
 * liveness check instead of each independently discovering coldness only
 * after its own request has already gone out and failed. `inFlightCheck` is
 * assigned synchronously (before the first await), so same-tick callers —
 * even from a `Promise.all` — dedup onto the same check rather than each
 * firing their own; `warmUntil` then skips the check entirely for a short
 * window so confirmed warmth doesn't cost an extra round trip per call.
 */
export async function ensureWarm(): Promise<void> {
  if (state.status === "warming") return waitUntilWarm();
  if (Date.now() < warmUntil) return;

  if (!inFlightCheck) {
    inFlightCheck = fetch("/api/warmup-status", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { warm: boolean }) => body.warm)
      .catch(() => false)
      .finally(() => {
        inFlightCheck = null;
      });
  }
  const warm = await inFlightCheck;

  if (warm) {
    warmUntil = Date.now() + WARM_CACHE_MS;
    return;
  }
  return waitUntilWarm();
}
