"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";

type Provider = "MONNIFY" | "PAYSTACK";
type Environment = "SANDBOX" | "LIVE";
interface GatewayConfigItem {
  id: string;
  provider: Provider;
  contractCode: string | null;
  reservedAccountEnabled: boolean;
  environment: Environment;
  isActive: boolean;
}

const ENV_VARIANT: Record<Environment, BadgeVariant> = { SANDBOX: "muted", LIVE: "warning" };

/**
 * PRD FR7.7: apiKey/secretKey are never selected by the backend at all (not
 * masked — fully absent from every read endpoint), so there's nothing to
 * show for them. `isActive` here means "this row's credentials are
 * configured and usable," NOT "this is the provider new checkouts use right
 * now" — that's PAYMENT_GATEWAY_PROVIDER, an env var no endpoint exposes.
 */
export function PaymentGatewayConfigList() {
  const [configs, setConfigs] = useState<GatewayConfigItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<GatewayConfigItem[]>("/payment-gateway-configs", { auth: true })
      .then(setConfigs)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load gateway configs"));
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!configs) return <p className="text-sm text-muted">Loading…</p>;
  if (configs.length === 0) return <p className="text-sm text-muted">No payment gateways configured yet.</p>;

  return (
    <table className="w-full text-left text-[12.5px]">
      <thead>
        <tr className="border-b border-border text-muted">
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Provider</th>
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Environment</th>
          <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
          <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Monnify settings</th>
        </tr>
      </thead>
      <tbody>
        {configs.map((config) => (
          <tr key={config.id} className="border-b border-border/60 last:border-none">
            <td className="py-2.5 pr-4 font-medium">{config.provider}</td>
            <td className="py-2.5 pr-4">
              <Badge variant={ENV_VARIANT[config.environment]}>{config.environment}</Badge>
            </td>
            <td className="py-2.5 pr-4">
              <Badge variant={config.isActive ? "success" : "muted"}>{config.isActive ? "Configured" : "Not configured"}</Badge>
            </td>
            <td className="py-2.5 text-muted">
              {config.provider === "MONNIFY"
                ? `${config.contractCode ?? "no contract code"} · reserved accounts ${config.reservedAccountEnabled ? "on" : "off"}`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
