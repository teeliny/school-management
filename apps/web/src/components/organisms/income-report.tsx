"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCurrency } from "../../lib/currency";
import { StatCard } from "../atoms/stat-card";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { BarChart } from "../molecules/chart";

type PaymentMethod = "CASH" | "BANK_TRANSFER_MANUAL" | "GATEWAY_CARD" | "GATEWAY_TRANSFER" | "GATEWAY_USSD" | "GATEWAY_RESERVED_ACCOUNT";
type GatewayProvider = "PAYSTACK" | "MONNIFY";

interface IncomeReportResponse {
  startDate: string;
  endDate: string;
  totalIncome: number;
  totalCount: number;
  dailyIncome: { date: string; total: number; count: number }[];
  byMethod: { method: PaymentMethod; total: number; count: number }[];
  byGateway: { gatewayProvider: GatewayProvider; total: number; count: number }[];
}
interface ClassLevel {
  id: string;
  name: string;
  order: number;
}

const ALL = "ALL";
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER_MANUAL: "Bank transfer (manual)",
  GATEWAY_CARD: "Gateway — card",
  GATEWAY_TRANSFER: "Gateway — transfer",
  GATEWAY_USSD: "Gateway — USSD",
  GATEWAY_RESERVED_ACCOUNT: "Gateway — reserved account",
};
const GATEWAY_LABEL: Record<GatewayProvider, string> = { PAYSTACK: "Paystack", MONNIFY: "Monnify" };

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthIsoDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/**
 * Super-Admin-only: sum of SUCCESSFUL payments per day over a date range,
 * filterable by payment method (cash/bank transfer/gateway) and, for
 * gateway payments specifically, which provider (Paystack/Monnify)
 * processed them — plus an optional class-level narrowing. Backed by
 * DashboardController.incomeReport, Super-Admin-gated the same way as
 * every other /dashboard/* route (a manual check inside DashboardService,
 * not CASL — see that module's own class comment). Defaults to
 * month-to-date, matching the calendar-day-inclusive range the backend
 * computes against `paidAt`. Rendered as the "Income Report" tab on
 * /fees (Super-Admin only, apps/web/src/app/fees/page.tsx) rather than
 * its own route — it's one more view into the same fees domain every
 * other tab on that page already covers.
 */
export function IncomeReport() {
  const [startDate, setStartDate] = useState(firstOfMonthIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [method, setMethod] = useState("");
  const [gatewayProvider, setGatewayProvider] = useState("");
  const [classLevelId, setClassLevelId] = useState("");

  const { data: classLevels } = useQuery({
    queryKey: ["class-levels"],
    queryFn: () => apiFetch<ClassLevel[]>("/class-levels", { auth: true }),
  });

  const isGatewayMethod = method.startsWith("GATEWAY_");
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ startDate, endDate });
    if (method) params.set("method", method);
    // Only meaningful alongside a GATEWAY_* method (or with no method filter
    // at all, to see every gateway payment regardless of channel) — cleared
    // automatically below whenever a non-gateway method is picked instead.
    if (gatewayProvider && (isGatewayMethod || !method)) params.set("gatewayProvider", gatewayProvider);
    if (classLevelId) params.set("classLevelId", classLevelId);
    return params.toString();
  }, [startDate, endDate, method, gatewayProvider, classLevelId, isGatewayMethod]);

  const { data, error, isFetching } = useQuery({
    queryKey: ["dashboard", "income-report", queryString],
    queryFn: () => apiFetch<IncomeReportResponse>(`/dashboard/income-report?${queryString}`, { auth: true }),
    enabled: Boolean(startDate && endDate),
  });

  const errorMessage = error instanceof ApiError ? error.message : error ? "Failed to load income report" : null;
  const chartData = (data?.dailyIncome ?? []).map((row) => ({ date: row.date.slice(5), total: row.total }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          aria-label="From date"
          className="w-full sm:w-40 sm:flex-none"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          aria-label="To date"
          className="w-full sm:w-40 sm:flex-none"
        />
        <Select
          value={method || ALL}
          onValueChange={(v) => {
            setMethod(v === ALL ? "" : v);
            if (v !== ALL && !v.startsWith("GATEWAY_")) setGatewayProvider("");
          }}
        >
          <SelectTrigger className="w-full sm:w-56 sm:flex-none" aria-label="Filter by payment method">
            <SelectValue placeholder="All payment methods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payment methods</SelectItem>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <SelectItem key={m} value={m}>
                {METHOD_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={gatewayProvider || ALL} onValueChange={(v) => setGatewayProvider(v === ALL ? "" : v)} disabled={method !== "" && !isGatewayMethod}>
          <SelectTrigger className="w-full sm:w-44 sm:flex-none" aria-label="Filter by gateway provider">
            <SelectValue placeholder="All gateways" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All gateways</SelectItem>
            {(Object.keys(GATEWAY_LABEL) as GatewayProvider[]).map((g) => (
              <SelectItem key={g} value={g}>
                {GATEWAY_LABEL[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={classLevelId || ALL} onValueChange={(v) => setClassLevelId(v === ALL ? "" : v)}>
          <SelectTrigger className="w-full sm:w-44 sm:flex-none" aria-label="Filter by class level">
            <SelectValue placeholder="All class levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All class levels</SelectItem>
            {classLevels?.map((level) => (
              <SelectItem key={level.id} value={level.id}>
                {level.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      {!data ? (
        <p className="text-sm text-muted">{isFetching ? "Loading…" : "Choose a date range to see income."}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard label="Total income" value={formatCurrency(data.totalIncome)} sub={`${data.startDate} → ${data.endDate}`} />
            <StatCard label="Payments" value={data.totalCount} sub="Matching the current filters" />
          </div>

          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Income per day</div>
            {chartData.length > 0 ? (
              <BarChart data={chartData} xKey="date" yKey="total" height={220} />
            ) : (
              <p className="text-sm text-muted">No successful payments in this range.</p>
            )}
          </div>

          {data.byMethod.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">By payment method</div>
              <div className="space-y-1">
                {data.byMethod.map((row) => (
                  <div key={row.method} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12.5px]">
                    <span>{METHOD_LABEL[row.method]}</span>
                    <span className="font-mono">
                      {formatCurrency(row.total)} <span className="text-muted">({row.count})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.byGateway.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">By gateway</div>
              <div className="space-y-1">
                {data.byGateway.map((row) => (
                  <div
                    key={row.gatewayProvider}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12.5px]"
                  >
                    <span>{GATEWAY_LABEL[row.gatewayProvider]}</span>
                    <span className="font-mono">
                      {formatCurrency(row.total)} <span className="text-muted">({row.count})</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
