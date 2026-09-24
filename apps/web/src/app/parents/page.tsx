"use client";

import { useState } from "react";
import { UserCog } from "lucide-react";
import { useCurrentUser } from "../../lib/use-current-user";
import { AppShell } from "../../components/templates/app-shell";
import { PageLoadingSkeleton } from "../../components/templates/page-loading-skeleton";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { EmptyState } from "../../components/molecules/empty-state";
import { ParentList } from "../../components/organisms/parent-list";
import { EditParentForm } from "../../components/organisms/edit-parent-form";

export default function ParentsPage() {
  const { user, loading, logout } = useCurrentUser();
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingParentId, setEditingParentId] = useState<string | null>(null);

  if (loading) {
    return <PageLoadingSkeleton />;
  }
  if (!user) return null;

  // Mirrors ability.factory.ts: Admin/Super-Admin hold "manage
  // ParentProfile" (edit, incl. the one-time email change); Registrar/
  // Bursar hold "read" only, so they get the list without the edit panel.
  const canManage = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");
  const canView = canManage || ["REGISTRAR", "BURSAR"].some((t) => user.assignmentTypes.includes(t));

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="People · Parents" title="Parents" />

      {canManage ? (
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="Parents" sub="All parents and their students" />
            <ParentList refreshKey={refreshKey} selectedId={editingParentId} onEdit={setEditingParentId} />
          </Card>

          {editingParentId ? (
            <Card>
              <CardHeader title="Edit parent" />
              <EditParentForm
                key={editingParentId}
                parentId={editingParentId}
                canChangeEmail={canManage}
                onSaved={() => setRefreshKey((k) => k + 1)}
                onCancel={() => setEditingParentId(null)}
              />
            </Card>
          ) : (
            <Card>
              <CardHeader title="Edit parent" />
              <EmptyState
                icon={UserCog}
                title="No parent selected"
                description="Choose a parent from the list to view their students and edit their details."
              />
            </Card>
          )}
        </div>
      ) : canView ? (
        <Card>
          <CardHeader title="Parents" sub="All parents and their students" />
          <ParentList />
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">You don&apos;t have permission to view parents.</p>
        </Card>
      )}
    </AppShell>
  );
}
