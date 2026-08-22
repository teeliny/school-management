import { ensureWarm, waitUntilWarm } from "./warmup-store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function isWarmingResponse(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  // Clone before reading — an unrelated genuine 503 (e.g. a degraded
  // downstream dependency) must leave the body unread for the normal
  // !res.ok handling below to still parse its real error message.
  const body = await res
    .clone()
    .json()
    .catch(() => null);
  return Boolean(body && (body as { warming?: boolean }).warming);
}

export async function login(email: string, password: string, _isRetry = false): Promise<void> {
  if (!_isRetry) await ensureWarm();

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!_isRetry && (await isWarmingResponse(res))) {
    await waitUntilWarm();
    return login(email, password, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
  _isRetry = false,
): Promise<T> {
  if (!_isRetry) await ensureWarm();

  // A FormData body (the manual-bank-transfer proof-of-payment upload) must
  // NOT be JSON-stringified, and the Content-Type header must be left unset
  // so the browser can attach its own `multipart/form-data; boundary=...`.
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`/api/proxy${path}`, {
    method: options.method ?? "GET",
    headers: isFormData ? undefined : { "Content-Type": "application/json" },
    body: isFormData ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!_isRetry && (await isWarmingResponse(res))) {
    await waitUntilWarm();
    return apiFetch<T>(path, options, true);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }

  // Some success responses (e.g. 201 from a queue-backed "generate" action)
  // carry an empty body — res.json() throws SyntaxError on "", which read as
  // a generic failure even though the request succeeded. Parse from text so
  // any empty body (204 or otherwise) resolves to undefined instead.
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}
