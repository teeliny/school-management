"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Live unread-count + newly-arrived-notification updates over the backend's
 * WebSocket gateway (apps/api/src/notifications/notifications.gateway.ts).
 * Socket.IO's handshake auth is client-side JS, which can't read the
 * httpOnly access-token cookie — /api/socket-token bridges that (see its
 * own doc comment). A missed live update just means the badge catches up on
 * the next poll/nav, not a broken feature — one bounded reconnect attempt
 * with a freshly-fetched token, no aggressive retry loop beyond that.
 */
export function useNotificationSocket(onNotification?: (notification: NotificationPayload) => void) {
  const [unreadCount, setUnreadCount] = useState(0);
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  useEffect(() => {
    let socket: Socket | null = null;
    let retried = false;
    let cancelled = false;

    async function connect() {
      const res = await fetch("/api/socket-token");
      if (!res.ok || cancelled) return;
      const body: { token: string | null } = await res.json();
      if (!body.token || cancelled) return;

      socket = io(API_URL, { transports: ["websocket"], auth: { token: body.token } });
      socket.on("notification:unread-count", (count: number) => setUnreadCount(count));
      socket.on("notification:new", (notification: NotificationPayload) => onNotificationRef.current?.(notification));
      socket.on("disconnect", (reason: string) => {
        if (reason === "io server disconnect" && !retried && !cancelled) {
          retried = true;
          connect();
        }
      });
    }

    connect();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, []);

  return { unreadCount, setUnreadCount };
}
