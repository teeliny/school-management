import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/providers/theme-provider";
import { QueryProvider } from "../components/providers/query-provider";
import { ApiWarmupBanner } from "../components/organisms/api-warmup-banner";
import { cn } from "../lib/cn";
import { siteContent } from "../lib/site-content";
import { SITE_URL } from "../lib/site-url";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
});
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: siteContent.schoolName,
    template: `%s | ${siteContent.schoolName}`,
  },
  description: siteContent.tagline,
  icons: { icon: "/favicon.ico" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: siteContent.schoolName,
    title: siteContent.schoolName,
    description: siteContent.tagline,
    images: [{ url: siteContent.crestLetter }],
  },
  twitter: {
    card: "summary",
    title: siteContent.schoolName,
    description: siteContent.tagline,
    images: [siteContent.crestLetter],
  },
  // Private by default — the student/staff portal behind login isn't meant to
  // be indexed. The public marketing site ((public)/layout.tsx) opts back in.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before React hydrates, which would otherwise trigger a mismatch warning.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(fraunces.variable, ibmPlexSans.variable, ibmPlexMono.variable)}
    >
      <body>
        <QueryProvider>
          <ThemeProvider>
            <ApiWarmupBanner />
            {children}
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
