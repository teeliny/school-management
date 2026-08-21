import "server-only";
import Redis from "ioredis";

// Must match apps/api/src/warmup/warmup.interceptor.ts's LAST_ACTIVE_KEY
// exactly — duplicated, not shared, same as parseCorsOrigins().
const LAST_ACTIVE_KEY = "api:last-active";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const HEALTH_PROBE_TIMEOUT_MS = 5000;

declare global {
  // Survives dev-mode HMR module re-evaluation, avoiding a new Redis connection per file save.
  var __warmupRedis: Redis | undefined;
}

function getRedis(): Redis {
  if (!globalThis.__warmupRedis) {
    const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    // ioredis emits unhandled 'error' events on a persistent client; must be
    // handled or a Redis outage can crash the Next.js server process.
    client.on("error", () => {});
    globalThis.__warmupRedis = client;
  }
  return globalThis.__warmupRedis;
}

export async function isApiWarm(): Promise<boolean> {
  try {
    return (await getRedis().get(LAST_ACTIVE_KEY)) !== null;
  } catch {
    return false;
  }
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
  if (await isApiWarm()) return true;
  return probeApiAlive();
}
