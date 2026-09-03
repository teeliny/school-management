"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { FormField } from "../molecules/form-field";
import { Textarea } from "../atoms/textarea";

interface StaffProfileDetail {
  id: string;
  user: { email: string; phone: string | null };
}

interface ParentProfileDetail {
  id: string;
  occupation: string | null;
  address: string | null;
  user: { email: string; phone: string | null };
}

/**
 * A single self-service "my profile" form covering every role the current
 * User holds — someone can be both Staff and a Parent at once (e.g. a
 * teacher whose own child attends the school), and `phone` lives on the
 * shared User row either way, so a Staff-only and a Parent-only form would
 * each show their own Email/Phone pair — two boxes editing the same
 * underlying value, with no indication either was in sync with the other.
 * One Email/Phone pair here instead, saved through every profile endpoint
 * the caller actually has; Address/Occupation only apply (and only show)
 * for the Parent side, since Staff self-service has no equivalent fields
 * (see StaffProfileController.update's HR-field restriction).
 */
export function ProfileForm({
  staffProfileId,
  parentProfileId,
}: {
  staffProfileId: string | null;
  parentProfileId: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: staffProfile } = useQuery({
    queryKey: ["staff-profile", staffProfileId],
    queryFn: () => apiFetch<StaffProfileDetail>(`/staff-profiles/${staffProfileId}`, { auth: true }),
    enabled: !!staffProfileId,
  });
  const { data: parentProfile } = useQuery({
    queryKey: ["parent-profile", parentProfileId],
    queryFn: () => apiFetch<ParentProfileDetail>(`/parent-profiles/${parentProfileId}`, { auth: true }),
    enabled: !!parentProfileId,
  });

  const ready = (!staffProfileId || !!staffProfile) && (!parentProfileId || !!parentProfile);
  const email = staffProfile?.user.email ?? parentProfile?.user.email ?? "";

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [occupation, setOccupation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Only seed local form state the first time both applicable profiles have
  // loaded — a post-save refetch shouldn't clobber whatever's mid-typing.
  const initialized = useRef(false);
  useEffect(() => {
    if (!ready || initialized.current) return;
    initialized.current = true;
    setPhone(staffProfile?.user.phone ?? parentProfile?.user.phone ?? "");
    setAddress(parentProfile?.address ?? "");
    setOccupation(parentProfile?.occupation ?? "");
  }, [ready, staffProfile, parentProfile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      await Promise.all([
        staffProfileId
          ? apiFetch(`/staff-profiles/${staffProfileId}`, {
              method: "PATCH",
              auth: true,
              body: { phone: phone || undefined },
            })
          : null,
        parentProfileId
          ? apiFetch(`/parent-profiles/${parentProfileId}`, {
              method: "PATCH",
              auth: true,
              body: { phone: phone || undefined, address: address || undefined, occupation: occupation || undefined },
            })
          : null,
      ]);
      setSaved(true);
      if (staffProfileId) queryClient.invalidateQueries({ queryKey: ["staff-profile", staffProfileId] });
      if (parentProfileId) queryClient.invalidateQueries({ queryKey: ["parent-profile", parentProfileId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update profile");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Saved.</p>}

      <div>
        <Label htmlFor="profile-email">Email</Label>
        <p id="profile-email" className="mt-1 text-sm text-muted">
          {email}
        </p>
      </div>

      <FormField label="Phone" id="profile-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />

      {parentProfileId && (
        <>
          <div>
            <Label htmlFor="profile-address">Address</Label>
            <Textarea id="profile-address" className="mt-1" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <FormField
            label="Occupation"
            id="profile-occupation"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
          />
        </>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
