"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";

interface CareerContactInquiryItem {
  id: string;
  type: "CAREERS" | "GENERAL";
  fullName: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  status: "NEW" | "REVIEWED";
  createdAt: string;
}

export function CareerContactInquiryList() {
  const queryClient = useQueryClient();
  const {
    data: inquiries,
    error: queryError,
  } = useQuery({
    queryKey: ["career-contact-inquiries"],
    queryFn: () => apiFetch<CareerContactInquiryItem[]>("/career-contact-inquiries", { auth: true }),
  });
  const error = queryError instanceof ApiError ? queryError.message : queryError ? "Failed to load inquiries" : null;

  async function markReviewed(id: string) {
    await apiFetch(`/career-contact-inquiries/${id}`, { method: "PATCH", auth: true });
    queryClient.invalidateQueries({ queryKey: ["career-contact-inquiries"] });
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!inquiries) return <p className="text-sm text-muted">Loading…</p>;
  if (inquiries.length === 0) return <p className="text-sm text-muted">No careers/contact inquiries yet.</p>;

  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Date</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Type</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">From</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Subject</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Message</th>
            <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
            <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {inquiries.map((inquiry) => (
            <tr key={inquiry.id} className="border-b border-border/60 align-top last:border-none">
              <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-muted">
                {new Date(inquiry.createdAt).toLocaleDateString()}
              </td>
              <td className="py-2.5 pr-4">
                <Badge variant={inquiry.type === "CAREERS" ? "warning" : "info"}>{inquiry.type}</Badge>
              </td>
              <td className="py-2.5 pr-4">
                <div className="font-medium">{inquiry.fullName}</div>
                <div className="text-muted">{inquiry.email}</div>
                {inquiry.phone && <div className="font-mono text-muted">{inquiry.phone}</div>}
              </td>
              <td className="py-2.5 pr-4">{inquiry.subject ?? "—"}</td>
              <td className="max-w-xs py-2.5 pr-4 text-muted">{inquiry.message}</td>
              <td className="py-2.5 pr-4">
                <Badge variant={inquiry.status === "NEW" ? "info" : "muted"}>{inquiry.status}</Badge>
              </td>
              <td className="py-2.5">
                {inquiry.status === "NEW" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => markReviewed(inquiry.id)}>
                    Mark reviewed
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
