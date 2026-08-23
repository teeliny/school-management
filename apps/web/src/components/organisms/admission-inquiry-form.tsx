"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Button } from "../atoms/button";

const initialState = {
  parentFullName: "",
  parentEmail: "",
  parentPhone: "",
  studentFullName: "",
  desiredEntryClass: "",
  message: "",
  website: "", // honeypot — see apps/api's CreateAdmissionInquiryDto.website
};

export function AdmissionInquiryForm() {
  const [form, setForm] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function set<K extends keyof typeof initialState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/admission-inquiries", { method: "POST", body: form });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p className="rounded-lg bg-card-inset px-4 py-3.5 text-[13px] leading-relaxed text-muted">
        Thank you — your admission inquiry has been received. Our admissions team will reach out shortly.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Parent/guardian full name"
          id="parentFullName"
          required
          value={form.parentFullName}
          onChange={(e) => set("parentFullName", e.target.value)}
        />
        <FormField
          label="Email"
          id="parentEmail"
          type="email"
          required
          value={form.parentEmail}
          onChange={(e) => set("parentEmail", e.target.value)}
        />
        <FormField
          label="Phone (optional)"
          id="parentPhone"
          value={form.parentPhone}
          onChange={(e) => set("parentPhone", e.target.value)}
        />
        <FormField
          label="Student full name (optional)"
          id="studentFullName"
          value={form.studentFullName}
          onChange={(e) => set("studentFullName", e.target.value)}
        />
      </div>

      <FormField
        label="Desired entry class"
        id="desiredEntryClass"
        required
        placeholder="e.g. Primary 3, JSS1"
        value={form.desiredEntryClass}
        onChange={(e) => set("desiredEntryClass", e.target.value)}
      />

      <div>
        <Label htmlFor="message">Message</Label>
        <Textarea
          id="message"
          required
          rows={4}
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
        />
      </div>

      {/* Honeypot — hidden from sighted and keyboard users, but present in
          the DOM for a bot to fill. Never remove aria-hidden/tabIndex, and
          never style this visible. */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full justify-center sm:w-auto">
        {submitting ? "Submitting…" : "Submit inquiry"}
      </Button>
    </form>
  );
}
