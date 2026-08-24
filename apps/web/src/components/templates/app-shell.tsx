"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  Mail,
  BookOpen,
  CalendarClock,
  CalendarCheck,
  Wallet,
  Building2,
  LogOut,
  ClipboardList,
  NotebookPen,
  MessageSquare,
  FileText,
  Calendar,
  Table,
  Bell,
  Inbox,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { CrestBadge } from "../atoms/crest-badge";
import { ThemeToggle } from "../molecules/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../molecules/dropdown-menu";
import { NotificationBell } from "../organisms/notification-bell";
import { cn } from "../../lib/cn";
import type { CurrentUser } from "../../lib/use-current-user";

interface NavContext {
  isAdmin: boolean;
  user: CurrentUser;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  // For rules broader than "admin only" (e.g. Admin or an active Registrar
  // assignment) — checked in addition to adminOnly, not instead of it.
  visible?: (ctx: NavContext) => boolean;
}

const NAV_SECTIONS: { eyebrow: string; items: NavItem[] }[] = [
  {
    eyebrow: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/notifications", label: "Notifications", icon: Bell },
      {
        href: "/inquiries",
        label: "Inquiries",
        icon: Inbox,
        // Matches AdmissionInquiryService.notifyStaff's recipient set —
        // Admin sees both tabs, Registrar/Principal/Headteacher see the
        // Admissions tab only (enforced inside the page itself).
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          ["REGISTRAR", "PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
    ],
  },
  {
    eyebrow: "People",
    items: [
      { href: "/students", label: "Students", icon: GraduationCap },
      {
        href: "/staff",
        label: "Staff assignments",
        icon: Users,
        adminOnly: true,
      },
      {
        href: "/invitations",
        label: "Invitations",
        icon: Mail,
        adminOnly: true,
      },
    ],
  },
  {
    eyebrow: "Academics",
    items: [
      {
        href: "/academic-structure",
        label: "Academic structure",
        icon: Building2,
        // Not `adminOnly` (that ANDs with `visible` rather than OR-ing) —
        // Principal/Headteacher get `manage AcademicStructure` too, per
        // ability.factory.ts's near-Admin-parity grant.
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          ["PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
      {
        href: "/subjects",
        label: "Subjects",
        icon: BookOpen,
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          ["PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
      {
        href: "/planner",
        label: "Planner",
        icon: CalendarClock,
        // Visible to every authenticated user — the four read endpoints
        // behind this page (TimetableSlot/ExamSchedule/InvigilationAssignment/
        // DutyAssignment) already default to APPROVED-only with no CASL gate
        // of their own, scoped for a Parent to their own ward(s) and derived
        // group-scoping for Principal/Headteacher. Only who can generate/
        // edit (the Union above) and who can give final approval
        // (Super-Admin only) still narrow, gated inside the page's own
        // Generate & Approve tab, not here — no `visible` predicate needed.
      },
    ],
  },
  {
    eyebrow: "Operations",
    items: [
      {
        href: "/attendance",
        label: "Attendance",
        icon: CalendarCheck,
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          user.assignmentTypes.includes("REGISTRAR") ||
          user.assignmentTypes.includes("CLASS_TEACHER") ||
          user.assignmentTypes.includes("SUBJECT_TEACHER") ||
          ["PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
      {
        href: "/fees",
        label: "Fees",
        icon: Wallet,
        // Deliberately narrower than `isAdmin` — a plain Admin has zero
        // visibility into the fees domain (matches the backend CASL grant).
        visible: ({ user }) =>
          user.roles.includes("SUPER_ADMIN") ||
          user.assignmentTypes.includes("BURSAR") ||
          user.roles.includes("PARENT"),
      },
    ],
  },
  {
    eyebrow: "Assessment",
    items: [
      {
        href: "/assessment-setup",
        label: "Assessment Setup",
        icon: ClipboardList,
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          ["PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
      {
        href: "/gradebook",
        label: "Gradebook",
        icon: NotebookPen,
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          user.assignmentTypes.includes("SUBJECT_TEACHER") ||
          ["PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
      {
        href: "/skills-comments",
        label: "Skills & Comments",
        icon: MessageSquare,
        visible: ({ isAdmin, user }) =>
          isAdmin ||
          ["CLASS_TEACHER", "SUBJECT_TEACHER", "PRINCIPAL", "HEADTEACHER"].some(
            (t) => user.assignmentTypes.includes(t),
          ),
      },
      { href: "/report-cards", label: "Report Cards", icon: FileText },
      {
        href: "/broadsheet",
        label: "Broadsheet",
        icon: Table,
        // Deliberately narrower than `isAdmin` — a plain Admin does not get
        // this one (matches the backend CASL grant in ability.factory.ts).
        visible: ({ user }) =>
          user.roles.includes("SUPER_ADMIN") ||
          ["PRINCIPAL", "HEADTEACHER"].some((t) =>
            user.assignmentTypes.includes(t),
          ),
      },
      { href: "/calendar", label: "Calendar", icon: Calendar },
    ],
  },
  {
    eyebrow: "Settings",
    items: [
      {
        href: "/school-profile",
        label: "School profile",
        icon: Settings,
        // Deliberately narrower than `isAdmin` — matches the backend CASL
        // check (ability.factory.ts's "manage SchoolProfile", granted only
        // via SUPER_ADMIN's "manage all", not the ADMIN/Principal/
        // Headteacher "manage AcademicStructure" grant).
        visible: ({ user }) => user.roles.includes("SUPER_ADMIN"),
      },
    ],
  },
];

export function AppShell({
  user,
  onLogout,
  children,
}: {
  user: CurrentUser;
  onLogout: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin =
    user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");
  const initials =
    `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();

  return (
    <div className="min-h-screen">
      {/* Collapsed to an icon rail by default, on every breakpoint — hovering
          expands it as a fixed overlay (doesn't push `main`, which always
          reserves just the collapsed width). Label text fades in via
          `group-hover`; `overflow-hidden` clips it while collapsed and
          mid-transition, so no separate width animation is needed on the
          labels themselves. */}
      <aside className="group fixed inset-y-0 left-0 z-40 flex w-[72px] flex-col gap-5 overflow-hidden border-r border-[rgb(var(--primary-foreground)/0.16)] bg-primary px-4 py-6 text-primary-foreground transition-[width] duration-200 ease-out hover:w-[246px] hover:shadow-[4px_0_28px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-2.5">
          <CrestBadge letter="S" variant="outline" />
          <div className="font-display whitespace-nowrap text-base font-semibold leading-tight opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            School Management
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 flex-1 max-h-[calc(100%-100px)] no-scrollbar overflow-y-auto">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => {
              if (item.adminOnly && !isAdmin) return false;
              if (item.visible && !item.visible({ isAdmin, user }))
                return false;
              return true;
            });
            if (items.length === 0) return null;
            return (
              <div key={section.eyebrow}>
                <div className="mb-1.5 mt-3.5 whitespace-nowrap px-2.5 text-[10px] uppercase tracking-wide opacity-0 transition-opacity duration-150 first:mt-0 group-hover:opacity-50">
                  {section.eyebrow}
                </div>
                {items.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-primary-foreground/80 transition-colors",
                        "hover:bg-primary-foreground/10 hover:text-primary-foreground",
                        active &&
                          "bg-primary-foreground/15 font-medium text-primary-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 flex-none opacity-80" />
                      <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto whitespace-nowrap border-t border-primary-foreground/15 pt-3.5 text-[11px] leading-relaxed opacity-0 transition-opacity duration-150 group-hover:opacity-55">
          Single-tenant deployment
        </div>
      </aside>

      <main className="ml-[72px] max-w-full px-5 pb-14 pt-5 sm:px-8 sm:pt-6">
        <div className="mb-5 flex items-center justify-end gap-3">
          <ThemeToggle />
          <NotificationBell />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-card-inset font-display text-xs font-semibold outline-none">
              {initials}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5 text-xs text-muted">
                {user.firstName} {user.lastName}
                <div className="mt-0.5">{user.roles.join(", ")}</div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onLogout}
                className="flex items-center gap-2"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {children}
      </main>
    </div>
  );
}
