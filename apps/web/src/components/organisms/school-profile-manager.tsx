"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Textarea } from "../atoms/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type AttendanceGranularity = "DAILY" | "MORNING_AND_AFTERNOON";

interface SchoolProfile {
  id: string;
  name: string;
  address: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  currency: string;
  timezone: string;
  attendanceBackdateWindowDays: number;
  attendanceGranularity: AttendanceGranularity;
}

// Single row, GET+PATCH only (no create/delete — the row itself is created
// once by `pnpm setup:school`). Several of these fields (name, address,
// logoUrl, contactEmail, contactPhone) render directly on the report card
// header (report-card-pdf.util.ts) alongside the attendance line, which
// reads attendanceGranularity/attendanceBackdateWindowDays.
export function SchoolProfileManager() {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["school-profile"],
    queryFn: () => apiFetch<SchoolProfile>("/school-profile", { auth: true }),
  });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("");
  const [attendanceBackdateWindowDays, setAttendanceBackdateWindowDays] = useState("0");
  const [attendanceGranularity, setAttendanceGranularity] = useState<AttendanceGranularity>("DAILY");

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Only seed local form state the first time the profile loads — otherwise
  // the post-save refetch would clobber whatever the user is mid-typing.
  const initialized = useRef(false);
  useEffect(() => {
    if (!profile || initialized.current) return;
    initialized.current = true;
    setName(profile.name);
    setAddress(profile.address ?? "");
    setLogoUrl(profile.logoUrl ?? "");
    setContactEmail(profile.contactEmail ?? "");
    setContactPhone(profile.contactPhone ?? "");
    setCurrency(profile.currency);
    setTimezone(profile.timezone);
    setAttendanceBackdateWindowDays(String(profile.attendanceBackdateWindowDays));
    setAttendanceGranularity(profile.attendanceGranularity);
  }, [profile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      await apiFetch("/school-profile", {
        method: "PATCH",
        auth: true,
        body: {
          name,
          address: address || undefined,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          currency,
          timezone,
          attendanceBackdateWindowDays: Number(attendanceBackdateWindowDays),
          attendanceGranularity,
        },
      });
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["school-profile"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update school profile");
    } finally {
      setSubmitting(false);
    }
  }

  // Uploads immediately on file selection, same pattern as
  // PhotoUploadButton — logoUrl is set server-side (SchoolProfileService.
  // uploadLogo) so it's excluded from the PATCH body above entirely.
  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch<{ logoUrl: string }>("/school-profile/logo", {
        method: "POST",
        auth: true,
        body: formData,
      });
      setLogoUrl(result.logoUrl);
      queryClient.invalidateQueries({ queryKey: ["school-profile"] });
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : "Failed to upload logo");
    } finally {
      setLogoUploading(false);
    }
  }

  if (!profile) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}

      <FormField label="School name" id="sp-name" required value={name} onChange={(e) => setName(e.target.value)} />

      <div>
        <Label>School logo</Label>
        <div className="mt-1 flex items-center gap-3">
          <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-lg border border-border bg-card-inset">
            {logoUrl ? (
              <img src={logoUrl} alt="School logo" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted" />
            )}
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logoUploading}
              onClick={() => logoInputRef.current?.click()}
            >
              {logoUploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            <p className="mt-1 text-[11px] text-muted">JPEG, PNG, or WebP — up to 5MB. Shown on report cards.</p>
            {logoError && <p className="mt-1 text-[11px] text-danger">{logoError}</p>}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              void handleLogoFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="sp-address">Address</Label>
        <Textarea id="sp-address" className="mt-1" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Contact email"
          id="sp-contact-email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
        <FormField
          label="Contact phone"
          id="sp-contact-phone"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Currency (ISO code)"
          id="sp-currency"
          required
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
        <FormField
          label="Timezone (IANA)"
          id="sp-timezone"
          required
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Attendance backdate window (days)"
          id="sp-backdate-window"
          type="number"
          min={0}
          required
          value={attendanceBackdateWindowDays}
          onChange={(e) => setAttendanceBackdateWindowDays(e.target.value)}
        />
        <div>
          <Label htmlFor="sp-granularity">Attendance granularity</Label>
          <Select value={attendanceGranularity} onValueChange={(v) => setAttendanceGranularity(v as AttendanceGranularity)}>
            <SelectTrigger id="sp-granularity" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAILY">Daily (one session per day)</SelectItem>
              <SelectItem value="MORNING_AND_AFTERNOON">Morning &amp; afternoon (two sessions per day)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
