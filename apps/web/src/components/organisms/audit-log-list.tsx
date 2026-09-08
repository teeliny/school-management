"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface AuditLogRow {
  id: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  route: string;
  before: unknown;
  after: unknown;
}
interface AuditLogFilterOptions {
  entityTypes: string[];
  actions: string[];
}

const PAGE_SIZE = 25;
const ALL = "ALL";

const ACTION_VARIANT: Record<string, BadgeVariant> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "danger",
};

// PRD §7 Auditability NFR — the filterable listing behind AuditLogController
// (audit/audit-log.ts). Super-Admin-only, matching that endpoint's CASL gate;
// the caller (audit-log/page.tsx) is responsible for not rendering this for
// anyone else.
export function AuditLogList() {
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: filterOptions } = useQuery({
    queryKey: ["audit-log", "filter-options"],
    queryFn: () => apiFetch<AuditLogFilterOptions>("/audit-log/filter-options", { auth: true }),
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (entityType) params.set("entityType", entityType);
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("skip", String(page * PAGE_SIZE));
    params.set("take", String(PAGE_SIZE));
    return params.toString();
  }, [search, entityType, action, from, to, page]);

  const { data, error, isLoading } = useQuery({
    queryKey: ["audit-log", "list", queryString],
    queryFn: () => apiFetch<{ data: AuditLogRow[]; total: number }>(`/audit-log?${queryString}`, { auth: true }),
  });

  const hasFilters = Boolean(search || entityType || action || from || to);
  const resetFilters = () => {
    setSearch("");
    setEntityType("");
    setAction("");
    setFrom("");
    setTo("");
    setPage(0);
  };

  const errorMessage = error instanceof ApiError ? error.message : error ? "Failed to load audit log" : null;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      {/* flex-wrap, not a fixed grid-cols count — each control keeps a
          sane min width and simply wraps onto its own row rather than being
          squeezed or pushed past the card edge, so this stays correct at
          every viewport width instead of just the breakpoints a grid would
          have to enumerate. */}
      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          placeholder="Search actor, entity id, route…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          aria-label="Search audit log"
          // `flex-1` alone (flex-basis: 0) only grabs whatever's left after
          // the fixed-width controls claim their space — at a mid-width
          // viewport that leftover can shrink to almost nothing. A real
          // `min-w` floor forces the whole row to wrap onto a new line once
          // it can't fit, instead of squeezing the search box down.
          className="w-full sm:min-w-[240px] sm:flex-1"
        />
        <Select
          value={entityType || ALL}
          onValueChange={(v) => {
            setEntityType(v === ALL ? "" : v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-full sm:w-48 sm:flex-none" aria-label="Filter by entity type">
            <SelectValue placeholder="All entity types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All entity types</SelectItem>
            {filterOptions?.entityTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={action || ALL}
          onValueChange={(v) => {
            setAction(v === ALL ? "" : v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-full sm:w-40 sm:flex-none" aria-label="Filter by action">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {filterOptions?.actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
          aria-label="From date"
          className="w-full sm:w-40 sm:flex-none"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
          aria-label="To date"
          className="w-full sm:w-40 sm:flex-none"
        />
      </div>

      {hasFilters && (
        <button type="button" onClick={resetFilters} className="text-[12px] text-muted underline underline-offset-2 hover:text-foreground">
          Clear filters
        </button>
      )}

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data || data.data.length === 0 ? (
        <p className="text-sm text-muted">{hasFilters ? "No audit log entries match these filters." : "No activity yet."}</p>
      ) : (
        <>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="w-6 py-2" />
                  <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Time</th>
                  <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Actor</th>
                  <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Action</th>
                  <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Entity</th>
                  <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Route</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => {
                  const expanded = expandedId === row.id;
                  const hasDiff = row.before !== null || row.after !== null;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={`border-b border-border/60 last:border-none ${hasDiff ? "cursor-pointer" : ""}`}
                        onClick={() => hasDiff && setExpandedId(expanded ? null : row.id)}
                      >
                        <td className="py-2.5 text-muted">
                          {hasDiff ? expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" /> : null}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-muted">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-4 font-medium">
                          {row.actorName ?? "System"}
                          {row.actorEmail && <div className="text-[10.5px] font-normal text-muted">{row.actorEmail}</div>}
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge variant={ACTION_VARIANT[row.action] ?? "muted"}>{row.action}</Badge>
                        </td>
                        <td className="py-2.5 pr-4">
                          {row.entityType}
                          {row.entityId && <span className="font-mono text-muted"> ({row.entityId.slice(0, 8)})</span>}
                        </td>
                        <td className="py-2.5 font-mono text-muted">{row.route}</td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-border/60 last:border-none">
                          <td />
                          <td colSpan={5} className="py-2.5 pr-4">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div>
                                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Before</div>
                                <pre className="max-h-48 overflow-auto rounded-lg bg-card-inset p-2 font-mono text-[11px]">
                                  {row.before ? JSON.stringify(row.before, null, 2) : "—"}
                                </pre>
                              </div>
                              <div>
                                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">After</div>
                                <pre className="max-h-48 overflow-auto rounded-lg bg-card-inset p-2 font-mono text-[11px]">
                                  {row.after ? JSON.stringify(row.after, null, 2) : "—"}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>
              Page {page + 1} of {pageCount} · {total} entries
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
