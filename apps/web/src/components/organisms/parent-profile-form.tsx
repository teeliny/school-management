"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Textarea } from "../atoms/textarea";

interface ParentProfileDetail {
  id: string;
  occupation: string | null;
  address: string | null;
  user: { email: string; phone: string | null };
}

/**
 * Self-service contact info for a Parent — email is read-only here (see
 * StudentProfile's GuardianEmailChangeAction for the only way it can
 * change, a one-time Super-Admin/Registrar action). `phone` lives on User,
 * everything else on ParentProfile, but both are written through the same
 * PATCH /parent-profiles/:id request (ParentProfileService.update).
 */
export function ParentProfileForm({ parentProfileId }: { parentProfileId: string }) {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["parent-profile", parentProfileId],
    queryFn: () => apiFetch<ParentProfileDetail>(`/parent-profiles/${parentProfileId}`, { auth: true }),
  });

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [occupation, setOccupation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Only seed local form state the first time the profile loads — same
  // reasoning as SchoolProfileManager: a post-save refetch shouldn't
  // clobber whatever's mid-typing.
  const initialized = useRef(false);
  useEffect(() => {
    if (!profile || initialized.current) return;
    initialized.current = true;
    setPhone(profile.user.phone ?? "");
    setAddress(profile.address ?? "");
    setOccupation(profile.occupation ?? "");
  }, [profile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      await apiFetch(`/parent-profiles/${parentProfileId}`, {
        method: "PATCH",
        auth: true,
        body: {
          phone: phone || undefined,
          address: address || undefined,
          occupation: occupation || undefined,
        },
      });
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["parent-profile", parentProfileId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update profile");
    } finally {
      setSubmitting(false);
    }
  }

  if (!profile) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}

      <div>
        <Label htmlFor="parent-profile-email">Email</Label>
        <p id="parent-profile-email" className="mt-1 text-sm text-muted">
          {profile.user.email}
        </p>
      </div>

      <FormField label="Phone" id="parent-profile-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <div>
        <Label htmlFor="parent-profile-address">Address</Label>
        <Textarea id="parent-profile-address" className="mt-1" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>

      <FormField
        label="Occupation"
        id="parent-profile-occupation"
        value={occupation}
        onChange={(e) => setOccupation(e.target.value)}
      />

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
