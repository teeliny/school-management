"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { NotificationPayload } from "./use-notification-socket";

interface NotificationsPage {
  data: NotificationPayload[];
  total: number;
}

const PAGE_SIZE = 25;

/**
 * Backend-paginated, backend-filtered (unreadOnly, type) notification list —
 * same shape as usePaginatedStudents (apps/web/src/lib/use-paginated-students.ts):
 * accumulate pages, skip advances by however many rows are already loaded,
 * hasMore derived from the server's own `total`. Changing either filter
 * resets to the first page.
 */
export function useNotifications({
  unreadOnly,
  type,
  pageSize = PAGE_SIZE,
}: {
  unreadOnly: boolean;
  type: string;
  pageSize?: number;
}) {
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an in-flight request from a superseded filter combo
  // resolving after a newer one and clobbering the list with stale data.
  const requestId = useRef(0);

  const loadPage = useCallback(
    (skip: number) => {
      const thisRequest = ++requestId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ skip: String(skip), take: String(pageSize) });
      if (unreadOnly) params.set("unreadOnly", "true");
      if (type) params.set("type", type);
      apiFetch<NotificationsPage>(`/notifications?${params.toString()}`, { auth: true })
        .then((res) => {
          if (thisRequest !== requestId.current) return;
          setNotifications((prev) => (skip === 0 ? res.data : [...prev, ...res.data]));
          setTotal(res.total);
        })
        .catch((err) => {
          if (thisRequest !== requestId.current) return;
          setError(err instanceof ApiError ? err.message : "Failed to load notifications");
        })
        .finally(() => {
          if (thisRequest === requestId.current) setLoading(false);
        });
    },
    [unreadOnly, type, pageSize],
  );

  useEffect(() => {
    setNotifications([]);
    setTotal(0);
    loadPage(0);
  }, [unreadOnly, type, loadPage]);

  const loadMore = useCallback(() => {
    loadPage(notifications.length);
  }, [loadPage, notifications.length]);

  return {
    notifications,
    total,
    loading,
    error,
    hasMore: notifications.length < total,
    loadMore,
    reload: () => loadPage(0),
    markReadLocally: (id: string) =>
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))),
    markAllReadLocally: () => setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true }))),
  };
}
