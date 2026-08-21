export type WarmupState = { status: "idle" } | { status: "warming"; startedAt: number };

const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 90_000; // 60s countdown shown to the user + 30s slack before giving up

let state: WarmupState = { status: "idle" };
const listeners = new Set<() => void>();
let waiters: Array<() => void> = [];
let pollTimer: ReturnType<typeof setTimeout> | null = null;

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
 * Multiple concurrent apiFetch calls hitting a cold API all call this — it's
 * idempotent about starting the poll loop and just queues onto `waiters`, so
 * one shared poll loop resolves all of them together once warm.
 */
export function waitUntilWarm(): Promise<void> {
  if (state.status === "idle") setState({ status: "warming", startedAt: Date.now() });
  if (!pollTimer) poll();
  return new Promise((resolve) => waiters.push(resolve));
}

function resolveAllAndReset() {
  const toResolve = waiters;
  waiters = [];
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  setState({ status: "idle" });
  toResolve.forEach((resolve) => resolve());
}

async function poll() {
  if (state.status !== "warming") return;
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
