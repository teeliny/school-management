"use client";

import { useState } from "react";
import type { NotificationType } from "@school/types";
import { apiFetch } from "../../lib/api";
import { formatRelativeTime } from "../../lib/datetime";
import { cn } from "../../lib/cn";
import { useInfiniteScroll } from "../../lib/use-infinite-scroll";
import { useNotifications } from "../../lib/use-notifications";
import { Checkbox } from "../atoms/checkbox";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

const ALL_TYPES = "__all__";

// PASSWORD_RESET/INVITATION_RECEIVED are EMAIL-only channel (see
// packages/types/src/notifications.ts) — they never create an in-app
// Notification row, so they're deliberately left out of this list; filtering
// by either would always show zero results.
const FILTERABLE_TYPES: { value: NotificationType; label: string }[] = [
  { value: "REPORT_CARD_PUBLISHED", label: "Report card published" },
  { value: "INVOICE_OVERDUE", label: "Invoice overdue" },
  { value: "PAYMENT_RECEIVED", label: "Payment received" },
  { value: "DISCOUNT_REQUEST_APPROVED", label: "Discount approved" },
  { value: "DISCOUNT_REQUEST_REJECTED", label: "Discount rejected" },
  { value: "MANUAL_PAYMENT_APPROVED", label: "Bank transfer approved" },
  { value: "MANUAL_PAYMENT_REJECTED", label: "Bank transfer rejected" },
  { value: "ADMISSION_INQUIRY_RECEIVED", label: "Admission inquiry" },
  { value: "CAREER_CONTACT_INQUIRY_RECEIVED", label: "Careers/contact inquiry" },
];

/**
 * Backend-paginated (scroll to load more, via useInfiniteScroll) and
 * backend-filtered (unreadOnly, type both sent as query params — see
 * useNotifications) — no client-side slicing or array filtering.
 */
export function NotificationList() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState<string>(ALL_TYPES);

  const { notifications, total, loading, error, hasMore, loadMore, markReadLocally } = useNotifications({
    unreadOnly,
    type: type === ALL_TYPES ? "" : type,
  });

  const sentinelRef = useInfiniteScroll({ onLoadMore: loadMore, hasMore, loading });

  async function handleClick(id: string, isRead: boolean) {
    if (isRead) return;
    markReadLocally(id);
    await apiFetch(`/notifications/${id}/read`, { method: "PATCH", auth: true }).catch(() => {});
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox id="unread-only" checked={unreadOnly} onCheckedChange={(value) => setUnreadOnly(value === true)} />
          <Label htmlFor="unread-only" className="mb-0 cursor-pointer normal-case tracking-normal text-foreground">
            Unread only
          </Label>
        </div>
        <div className="min-w-[220px]">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>All types</SelectItem>
              {FILTERABLE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && notifications.length === 0 && !loading && <p className="text-sm text-muted">No notifications to show.</p>}

      {notifications.length > 0 && (
        <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n.id, n.isRead)}
              className="flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left last:border-none hover:border-white"
            >
              <span className={cn("mt-1.5 h-2 w-2 flex-none rounded-full", n.isRead ? "bg-transparent" : "bg-info")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{n.title}</span>
                <span className="block text-[12px] text-muted">{n.body}</span>
              </span>
              <span className="flex-none whitespace-nowrap font-mono text-[10.5px] text-muted">
                {formatRelativeTime(n.createdAt)}
              </span>
            </button>
          ))}
          <div ref={sentinelRef} />
          {loading && <p className="py-2 text-center text-[11.5px] text-muted">Loading…</p>}
        </div>
      )}

      {total > 0 && (
        <p className="text-[11px] text-muted">
          Showing {notifications.length} of {total}
        </p>
      )}
    </div>
  );
}
