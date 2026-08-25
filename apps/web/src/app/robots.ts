import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site-url";

// Everything is crawlable by default; only the authenticated app and its
// auth flows are carved out. Keep this in sync with apps/web/src/app/*
// whenever a new top-level private route is added.
const PRIVATE_PATHS = [
  "/dashboard",
  "/login",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
  "/verify-report",
  "/academic-structure",
  "/assessment-setup",
  "/attendance",
  "/broadsheet",
  "/calendar",
  "/fees",
  "/gradebook",
  "/health",
  "/inquiries",
  "/invitations",
  "/notifications",
  "/payments",
  "/planner",
  "/report-cards",
  "/school-profile",
  "/skills-comments",
  "/staff",
  "/students",
  "/subjects",
  "/api",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: PRIVATE_PATHS,
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
