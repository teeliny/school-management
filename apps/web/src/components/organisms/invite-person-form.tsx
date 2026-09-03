"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../molecules/select";

type InvitableRole = "ADMIN" | "STAFF" | "PARENT";
type StaffCategory = "TEACHING" | "NON_TEACHING";

interface InvitePersonFormProps {
  /** ADMIN is an owner-only invite (PRD FR1.2) — only offered to a Super-Admin viewer. */
  isSuperAdmin: boolean;
  onInvited?: () => void;
}

export function InvitePersonForm({ isSuperAdmin, onInvited }: InvitePersonFormProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<InvitableRole>("STAFF");
  const [staffCategory, setStaffCategory] = useState<StaffCategory>("TEACHING");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await apiFetch("/invitations", {
        method: "POST",
        auth: true,
        body: {
          firstName,
          lastName,
          email,
          invitedRole: role,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(role === "STAFF" ? { staffCategory } : {}),
        },
      });
      setSuccess(`Invitation sent to ${email}.`);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      onInvited?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}
      {success && <p className="text-sm text-success">{success}</p>}

      <FormField
        label="First name"
        id="invite-first-name"
        required
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <FormField
        label="Last name"
        id="invite-last-name"
        required
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
      <FormField
        label="Email"
        id="invite-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <FormField
        label="Phone (optional)"
        id="invite-phone"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <div>
        <Label htmlFor="invite-role">Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as InvitableRole)}>
          <SelectTrigger id="invite-role" className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="STAFF">Staff</SelectItem>
            <SelectItem value="PARENT">Parent</SelectItem>
            {isSuperAdmin && <SelectItem value="ADMIN">Admin</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {role === "STAFF" && (
        <div>
          <Label htmlFor="invite-staff-category">Staff category</Label>
          <Select
            value={staffCategory}
            onValueChange={(value) => setStaffCategory(value as StaffCategory)}
          >
            <SelectTrigger id="invite-staff-category" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TEACHING">Teaching</SelectItem>
              <SelectItem value="NON_TEACHING">Non-teaching</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}
