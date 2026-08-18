"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export interface ParentChild {
  id: string;
  currentClassId: string | null;
  status: string;
  user: { firstName: string; lastName: string };
}

/**
 * A parent's wards, shared by DashboardPage so it can hold one
 * "which child am I viewing" selection that both ParentDashboard and
 * MySchedule read, instead of each fetching its own list and picking
 * independently (which is what let MySchedule keep showing every child's
 * timetable after ParentDashboard got a single-child selector).
 */
export function useParentChildren(parentProfileId: string | null): ParentChild[] | null {
  const [children, setChildren] = useState<ParentChild[] | null>(null);

  useEffect(() => {
    if (!parentProfileId) {
      setChildren(null);
      return;
    }
    apiFetch<ParentChild[]>("/students", { auth: true })
      .then(setChildren)
      .catch(() => setChildren([]));
  }, [parentProfileId]);

  return children;
}
