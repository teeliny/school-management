"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { FormField } from "../molecules/form-field";
import { Button } from "../atoms/button";
import { Label } from "../atoms/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

type StaffCategory = "TEACHING" | "NON_TEACHING";
type StaffStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED";

interface StaffDetail {
  id: string;
  employeeId: string | null;
  staffCategory: StaffCategory | null;
  department: string | null;
  employmentDate: string | null;
  qualification: string | null;
  status: StaffStatus;
  user: { firstName: string; lastName: string; email: string; phone: string | null };
}

/**
 * Mirrors EditStudentForm — populates the right-hand panel on the Staff
 * page for a staff member selected via StaffList's "Edit" button.
 * StaffProfileController.update restricts non-"manage" callers to
 * `phone` only; this form is only rendered for canManage callers, so all
 * fields are sent.
 */
export function EditStaffForm({
  staffId,
  onSaved,
  onCancel,
}: {
  staffId: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [staffCategory, setStaffCategory] = useState<StaffCategory | "">("");
  const [department, setDepartment] = useState("");
  const [employmentDate, setEmploymentDate] = useState("");
  const [qualification, setQualification] = useState("");
  const [status, setStatus] = useState<StaffStatus>("ACTIVE");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<StaffDetail>(`/staff-profiles/${staffId}`, { auth: true })
      .then((staff) => {
        setFirstName(staff.user.firstName);
        setLastName(staff.user.lastName);
        setEmployeeId(staff.employeeId ?? "");
        setStaffCategory(staff.staffCategory ?? "");
        setDepartment(staff.department ?? "");
        setEmploymentDate(staff.employmentDate ? staff.employmentDate.slice(0, 10) : "");
        setQualification(staff.qualification ?? "");
        setStatus(staff.status);
        setPhone(staff.user.phone ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load staff"))
      .finally(() => setLoading(false));
  }, [staffId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/staff-profiles/${staffId}`, {
        method: "PATCH",
        auth: true,
        body: {
          employeeId,
          staffCategory: staffCategory || undefined,
          department,
          employmentDate: employmentDate || undefined,
          qualification,
          status,
          phone,
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

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <p className="text-sm font-medium">
        {firstName} {lastName}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Employee ID" id="edit-staff-employee-id" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
        <FormField label="Phone" id="edit-staff-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div>
          <Label htmlFor="edit-staff-category">Category</Label>
          <Select value={staffCategory} onValueChange={(value) => setStaffCategory(value as StaffCategory)}>
            <SelectTrigger id="edit-staff-category" className="mt-1">
              <SelectValue placeholder="Not specified" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TEACHING">Teaching</SelectItem>
              <SelectItem value="NON_TEACHING">Non-teaching</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-staff-status">Status</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as StaffStatus)}>
            <SelectTrigger id="edit-staff-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="ON_LEAVE">On leave</SelectItem>
              <SelectItem value="TERMINATED">Terminated</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FormField label="Department" id="edit-staff-department" value={department} onChange={(e) => setDepartment(e.target.value)} />
        <FormField
          label="Employment date"
          id="edit-staff-employment-date"
          type="date"
          value={employmentDate}
          onChange={(e) => setEmploymentDate(e.target.value)}
        />
      </div>

      <FormField label="Qualification" id="edit-staff-qualification" value={qualification} onChange={(e) => setQualification(e.target.value)} />

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="flex-1">
          {submitting ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
