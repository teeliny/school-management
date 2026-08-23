"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Button } from "../atoms/button";
import { cn } from "../../lib/cn";

type InquiryType = "CAREERS" | "GENERAL";

const initialState = {
  type: "GENERAL" as InquiryType,
  fullName: "",
  email: "",
  phone: "",
  subject: "",
  message: "",
  website: "", // honeypot — see apps/api's CreateCareerContactInquiryDto.website
};

export function CareerContactInquiryForm() {
  const [form, setForm] = useState(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function set<K extends keyof typeof initialState>(key: K, value: (typeof initialState)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/career-contact-inquiries", { method: "POST", body: form });
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
        Thank you — your message has been received. We&apos;ll get back to you shortly.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div>
        <Label>I&apos;m reaching out about</Label>
        <div className="mt-1.5 flex gap-2">
          {(["GENERAL", "CAREERS"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => set("type", option)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                form.type === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted hover:border-white",
              )}
            >
              {option === "GENERAL" ? "A general inquiry" : "A job opening"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Full name"
          id="fullName"
          required
          value={form.fullName}
          onChange={(e) => set("fullName", e.target.value)}
        />
        <FormField
          label="Email"
          id="email"
          type="email"
          required
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
        />
        <FormField
          label="Phone (optional)"
          id="phone"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
        <FormField
          label={form.type === "CAREERS" ? "Role you're applying for" : "Subject (optional)"}
          id="subject"
          value={form.subject}
          onChange={(e) => set("subject", e.target.value)}
        />
      </div>

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

      {/* Honeypot — see AdmissionInquiryForm. */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="cc-website">Website</label>
        <input
          id="cc-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full justify-center sm:w-auto">
        {submitting ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
