"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { CrestBadge } from "../atoms/crest-badge";

interface VerifyResult {
  valid: boolean;
  studentName?: string;
  admissionNumber?: string;
  className?: string | null;
  termName?: string;
  sessionName?: string;
  reportType?: string;
  generatedAt?: string | null;
  publishedAt?: string | null;
}

/**
 * Public, unauthenticated page (GET /term-report-cards/verify/:token has no
 * guards — apps/api/src/assessments/term-report-card.ts) reached by
 * scanning the QR code printed on a term report card
 * (report-card-pdf.util.ts). Deliberately shows no scores — just enough to
 * confirm the document is genuine.
 */
export function VerifyReportResult({ token }: { token: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<VerifyResult>(`/term-report-cards/verify/${token}`)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not reach the verification service"));
  }, [token]);

  return (
    <div className="w-[380px] max-w-full rounded-card border border-border bg-card px-8 py-8 text-center">
      <CrestBadge letter="S" variant="solid" size="lg" className="mx-auto mb-3.5" />
      <h1 className="font-display mb-4 text-lg font-semibold">Report card verification</h1>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!error && !result && <p className="text-sm text-muted">Checking…</p>}

      {!error && result && !result.valid && (
        <div className="flex flex-col items-center gap-2 text-danger">
          <CircleX className="h-8 w-8" />
          <p className="text-sm font-medium">Could not verify this report card</p>
          <p className="text-[11.5px] text-muted">
            This link is invalid, has expired, or the report card has not been published.
          </p>
        </div>
      )}

      {!error && result && result.valid && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-col items-center gap-2 text-success">
            <CircleCheck className="h-8 w-8" />
            <p className="text-sm font-medium">Genuine report card</p>
          </div>
          <dl className="w-full space-y-1.5 text-left text-[11.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Student</dt>
              <dd className="font-medium">
                {result.studentName} ({result.admissionNumber})
              </dd>
            </div>
            {result.className && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Class</dt>
                <dd className="font-medium">{result.className}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Term</dt>
              <dd className="font-medium">{result.termName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Session</dt>
              <dd className="font-medium">{result.sessionName}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
