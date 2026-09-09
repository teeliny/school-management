import "server-only";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const HEALTH_PROBE_TIMEOUT_MS = 5000;
// How long a confirmed-warm result is trusted before re-probing. This app
// runs on Vercel (serverless functions), not a persistent container — a
// previous version cached a persistent ioredis connection in globalThis to
// share "is the API warm" state via Redis across instances, but Vercel
// recycles function instances without a reliable shutdown hook reaching user
// code, so that connection leaked on every recycle (confirmed in production:
// CLIENT LIST showed dozens of idle orphaned connections from distinct
// container IPs). An in-memory cache scoped to this instance's own lifetime
// avoids holding any persistent external connection at all — the only cost
// is a fresh instance doing one extra health probe on its first request
// instead of reusing another instance's knowledge.
const WARM_CACHE_TTL_MS = 60_000;

declare global {
  var __apiWarmUntil: number | undefined;
}

export async function probeApiAlive(): Promise<boolean> {
  try {
    // Any HTTP response (200, or even a 503 "degraded" from an unrelated
    // downstream dependency) proves the process is up — only a thrown fetch
    // error (timeout/ECONNREFUSED) means "still cold." Don't gate on res.ok.
    await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

export async function checkApiReachable(): Promise<boolean> {
  if (globalThis.__apiWarmUntil && Date.now() < globalThis.__apiWarmUntil) return true;
  const alive = await probeApiAlive();
  if (alive) globalThis.__apiWarmUntil = Date.now() + WARM_CACHE_TTL_MS;
  return alive;
}
