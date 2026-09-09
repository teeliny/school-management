"use client";

import { useState } from "react";
import { UserCog } from "lucide-react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { EmptyState } from "../../components/molecules/empty-state";
import { StaffList } from "../../components/organisms/staff-list";
import { EditStaffForm } from "../../components/organisms/edit-staff-form";
import { StaffAssignmentForm } from "../../components/organisms/staff-assignment-form";
import { StaffAssignmentList } from "../../components/organisms/staff-assignment-list";
import { OwnershipTransferAction } from "../../components/organisms/ownership-transfer-action";

export default function StaffPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  const isSuperAdmin = user.roles.includes("SUPER_ADMIN");
  const canManage = isSuperAdmin || user.roles.includes("ADMIN");

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Staff" title="Staff" />

      {canManage ? (
        <div className="space-y-4">
          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Staff" sub="All staff profiles" />
              <StaffList refreshKey={refreshKey} canEdit={canManage} onEdit={setEditingStaffId} />
            </Card>

            {editingStaffId ? (
              <Card>
                <CardHeader title="Edit staff" />
                <EditStaffForm
                  staffId={editingStaffId}
                  onSaved={() => {
                    setEditingStaffId(null);
                    setRefreshKey((k) => k + 1);
                  }}
                  onCancel={() => setEditingStaffId(null)}
                />
              </Card>
            ) : (
              <Card>
                <CardHeader title="Edit staff" />
                <EmptyState
                  icon={UserCog}
                  title="No staff selected"
                  description="Choose a staff member from the list to edit their profile."
                />
              </Card>
            )}
          </div>

          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Role assignments" />
              <StaffAssignmentList refreshKey={refreshKey} />
            </Card>
            <Card>
              <CardHeader title="Assign staff" />
              <StaffAssignmentForm
                isSuperAdmin={isSuperAdmin}
                onAssigned={() => setRefreshKey((k) => k + 1)}
              />
            </Card>
          </div>

          {isSuperAdmin && (
            <Card>
              <CardHeader title="Transfer ownership" sub="Super-Admin only, cannot be undone" />
              <OwnershipTransferAction />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to manage staff.</p>
        </Card>
      )}
    </AppShell>
  );
}
