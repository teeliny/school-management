"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { formatRelativeTime } from "../../lib/datetime";
import { cn } from "../../lib/cn";
import { useNotificationSocket, type NotificationPayload } from "../../lib/use-notification-socket";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "../molecules/dropdown-menu";

const RECENT_TAKE = 8;

/**
 * Unread count: seeded from GET /notifications/unread-count on mount, then
 * kept live by the WebSocket gateway (useNotificationSocket) for the rest
 * of the session. The dropdown's recent list is a plain REST fetch on open
 * — no pagination here, that's what the full /notifications page is for.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<NotificationPayload[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { unreadCount, setUnreadCount } = useNotificationSocket((notification) => {
    setRecent((prev) => (prev ? [notification, ...prev].slice(0, RECENT_TAKE) : prev));
  });

  useEffect(() => {
    apiFetch<number>("/notifications/unread-count", { auth: true })
      .then(setUnreadCount)
      .catch(() => {});
  }, [setUnreadCount]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    apiFetch<{ data: NotificationPayload[]; total: number }>(`/notifications?take=${RECENT_TAKE}`, { auth: true })
      .then((res) => setRecent(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load notifications"));
  }, [open]);

  async function markRead(id: string) {
    setRecent((prev) => prev?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? null);
    setUnreadCount((count) => Math.max(0, count - 1));
    await apiFetch(`/notifications/${id}/read`, { method: "PATCH", auth: true }).catch(() => {});
  }

  async function markAllRead() {
    setRecent((prev) => prev?.map((n) => ({ ...n, isRead: true })) ?? null);
    setUnreadCount(0);
    await apiFetch("/notifications/read-all", { method: "PATCH", auth: true }).catch(() => {});
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-card-inset outline-none">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-bg px-1 font-mono text-[9px] font-semibold text-danger">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="font-display text-[13px] font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-[11px] font-medium text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {error && <p className="px-3 py-4 text-[12px] text-danger">{error}</p>}
          {!error && recent === null && <p className="px-3 py-4 text-[12px] text-muted">Loading…</p>}
          {!error && recent?.length === 0 && <p className="px-3 py-4 text-[12px] text-muted">No notifications yet.</p>}
          {recent?.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.isRead && markRead(n.id)}
              className="flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left last:border-none hover:bg-card-inset"
            >
              <span className={cn("mt-1 h-2 w-2 flex-none rounded-full", n.isRead ? "bg-transparent" : "bg-info")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{n.title}</span>
                <span className="block truncate text-[11.5px] text-muted">{n.body}</span>
              </span>
              <span className="flex-none whitespace-nowrap font-mono text-[10px] text-muted">
                {formatRelativeTime(n.createdAt)}
              </span>
            </button>
          ))}
        </div>

        <DropdownMenuSeparator className="m-0" />
        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="block px-3 py-2.5 text-center text-[11.5px] font-medium text-primary hover:underline"
        >
          View all →
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
