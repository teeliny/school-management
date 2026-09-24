"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Textarea } from "../atoms/textarea";
import { Badge } from "../atoms/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { GuardianEmailChangeAction } from "./guardian-email-change-action";
import { wardClassLabel, type ParentListItem } from "./parent-list";

type GuardianRelationship = "FATHER" | "MOTHER" | "GUARDIAN" | "OTHER";

interface ParentDetail extends ParentListItem {
  relationshipToStudentDefault: GuardianRelationship | null;
}

const RELATIONSHIP_LABEL: Record<GuardianRelationship, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  OTHER: "Other",
};

/**
 * Mirrors EditStaffForm — populates the right-hand panel on the Parents
 * page for a parent selected via ParentList's "Edit" button. Also lists the
 * parent's wards (read-only; guardianship links are managed from the
 * student side) and hosts the one-time email change action.
 */
export function EditParentForm({
  parentId,
  canChangeEmail,
  onSaved,
  onCancel,
}: {
  parentId: string;
  canChangeEmail: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [parent, setParent] = useState<ParentDetail | null>(null);
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [occupation, setOccupation] = useState("");
  const [address, setAddress] = useState("");
  const [relationship, setRelationship] = useState<GuardianRelationship | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ParentDetail>(`/parent-profiles/${parentId}`, { auth: true })
      .then((p) => {
        setParent(p);
        setFirstName(p.user.firstName);
        setMiddleName(p.user.middleName ?? "");
        setLastName(p.user.lastName);
        setPhone(p.user.phone ?? "");
        setOccupation(p.occupation ?? "");
        setAddress(p.address ?? "");
        setRelationship(p.relationshipToStudentDefault ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load parent"))
      .finally(() => setLoading(false));
  }, [parentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/parent-profiles/${parentId}`, {
        method: "PATCH",
        auth: true,
        body: {
          firstName,
          middleName,
          lastName,
          phone,
          occupation,
          address,
          relationshipToStudentDefault: relationship || undefined,
        },
      });
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (!parent) return <p className="text-sm text-danger">{error ?? "Parent not found"}</p>;

  return (
    <div className="w-full max-w-xl space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}

        <div>
          <Label>Email</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted">{parent.user.email}</span>
            {parent.emailBounced && <Badge variant="danger">Bounced</Badge>}
          </div>
          {canChangeEmail &&
            (parent.emailChangedByStaffAt ? (
              <p className="mt-1 text-[12px] text-muted">This email has already been changed once and can&apos;t be changed again here.</p>
            ) : (
              <div className="mt-1.5">
                <GuardianEmailChangeAction
                  parentProfileId={parent.id}
                  onChanged={() => {
                    load();
                    onSaved?.();
                  }}
                />
              </div>
            ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="First name" id="edit-parent-first-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <FormField label="Last name" id="edit-parent-last-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <FormField label="Middle name" id="edit-parent-middle-name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
          <FormField label="Phone" id="edit-parent-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <FormField label="Occupation" id="edit-parent-occupation" value={occupation} onChange={(e) => setOccupation(e.target.value)} />
          <div>
            <Label htmlFor="edit-parent-relationship">Default relationship</Label>
            <Select value={relationship} onValueChange={(value) => setRelationship(value as GuardianRelationship)}>
              <SelectTrigger id="edit-parent-relationship" className="mt-1">
                <SelectValue placeholder="Not specified" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RELATIONSHIP_LABEL) as GuardianRelationship[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {RELATIONSHIP_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="edit-parent-address">Address</Label>
          <Textarea id="edit-parent-address" className="mt-1" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>

      <div>
        <Label>Students</Label>
        {parent.wards.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No students linked to this parent.</p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {parent.wards.map((ward) => (
              <li key={ward.id} className="rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/students/${ward.student.id}`} className="font-medium hover:underline">
                    {formatPersonName(ward.student.user)}
                  </Link>
                  <Badge variant="info">{wardClassLabel(ward)}</Badge>
                  <Badge variant="muted">{ward.relationship}</Badge>
                  {ward.isPrimaryContact && <Badge variant="muted">Primary</Badge>}
                </div>
                <p className="mt-0.5 font-mono text-[11.5px] text-muted">
                  {ward.student.admissionNumber}
                  {ward.student.status !== "ACTIVE" ? ` · ${ward.student.status}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
