import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { PublicLayout } from "../../components/templates/public-layout";
import { siteContent } from "../../lib/site-content";
import { SITE_URL } from "../../lib/site-url";
import { ACCESS_COOKIE } from "../../lib/server-cookies";

// The marketing site is the one part of this app meant to be publicly
// indexed — overrides the app-wide noindex default in the root layout.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

const schoolJsonLd = {
  "@context": "https://schema.org",
  "@type": "School",
  name: siteContent.schoolName,
  url: SITE_URL,
  logo: `${SITE_URL}${siteContent.crestLetter}`,
  description: siteContent.tagline,
  foundingDate: String(siteContent.foundedYear),
  address: {
    "@type": "PostalAddress",
    streetAddress: siteContent.contact.address,
    addressCountry: "NG",
  },
  telephone: siteContent.contact.phones[0],
  email: siteContent.contact.emails[0].value,
};

export default async function PublicRouteLayout({ children }: { children: ReactNode }) {
  // Read synchronously from the request cookie so the nav CTA renders as
  // Login/Dashboard on first paint, with no client round trip to /auth/me.
  // Presence-only, not signature-verified: a stale cookie just means a rare
  // "Dashboard" link that bounces to /login via the same 401 handling every
  // other protected page already has.
  const cookieStore = await cookies();
  const isLoggedIn = Boolean(cookieStore.get(ACCESS_COOKIE)?.value);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schoolJsonLd) }} />
      <PublicLayout isLoggedIn={isLoggedIn}>{children}</PublicLayout>
    </>
  );
}
