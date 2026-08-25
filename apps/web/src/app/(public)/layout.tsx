import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PublicLayout } from "../../components/templates/public-layout";
import { siteContent } from "../../lib/site-content";
import { SITE_URL } from "../../lib/site-url";

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

export default function PublicRouteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schoolJsonLd) }} />
      <PublicLayout>{children}</PublicLayout>
    </>
  );
}
