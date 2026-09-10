/**
 * Feature-detects (never user-agent sniffs) a set of runtime APIs that landed
 * in Chrome well after 83 (May 2020) — the oldest version seen crashing on
 * login/dashboard in production. Some school users are on Android devices
 * stuck on an old Chrome build the Play Store no longer updates, so this
 * flags "probably too old to run this app reliably" without guessing at a
 * specific version.
 */
export function isBrowserOutdated(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      typeof (globalThis as { structuredClone?: unknown }).structuredClone !== "function" ||
      typeof Array.prototype.at !== "function" ||
      typeof Object.hasOwn !== "function" ||
      typeof Promise.any !== "function" ||
      typeof String.prototype.replaceAll !== "function"
    );
  } catch {
    return true;
  }
}
