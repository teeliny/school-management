// A `datetime-local` input holds a naive "wall clock" string with no
// timezone ("2026-08-07T14:30") — the browser always interprets/produces it
// in the *user's* local timezone, never UTC. These two helpers are the only
// correct way to cross that boundary with an API that stores/returns UTC
// ISO strings: build/read the `Date` from its local components (never slice
// the ISO string directly — that reads UTC components instead of local
// ones, which is the bug this replaces).

// ISO/UTC string from the API -> local value for a <input type="datetime-local">.
export function toDatetimeLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// <input type="datetime-local"> value -> correct UTC ISO string for the API.
export function fromDatetimeLocalInputValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match;
  // The Date constructor's numeric-component form interprets its arguments
  // as local time, unlike `new Date(isoString)` — this is what makes the
  // conversion correct regardless of which timezone the browser is in.
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)).toISOString();
}

// "2m ago" / "3h ago" / "5d ago" style, matching docs/school-system-design.html's
// `.notif-time` — falls back to a plain date once it's more than a week old.
export function formatRelativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
