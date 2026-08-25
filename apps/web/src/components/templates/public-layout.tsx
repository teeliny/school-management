"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CrestBadge } from "../atoms/crest-badge";
import { Button } from "../atoms/button";
import { ThemeToggle } from "../molecules/theme-toggle";
import { cn } from "../../lib/cn";
import { siteContent } from "../../lib/site-content";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/academics", label: "Academics" },
  { href: "/admissions", label: "Admissions" },
  { href: "/careers", label: "Careers & Contact" },
];

export function PublicLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <CrestBadge letter={siteContent.crestLetter} darkLetter={siteContent.crestLetterDark} variant="solid" />
            <span className="font-display text-[15px] font-semibold leading-tight">{siteContent.schoolName}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground",
                    active && "text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <Button asChild size="sm" variant="outline">
              <Link href="/login">Login</Link>
            </Button>
          </div>
        </div>

        {/* Mobile nav — the sidebar's hover-expand pattern doesn't apply to a
            top nav, so small screens just get a wrapping link row instead of
            a hidden/hamburger menu, keeping this template dependency-free. */}
        <nav className="flex flex-wrap gap-x-1 gap-y-1 border-t border-border px-5 py-2 md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border bg-card-inset">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <CrestBadge letter={siteContent.crestLetter} darkLetter={siteContent.crestLetterDark} variant="solid" size="sm" />
              <span className="font-display text-[14px] font-semibold">{siteContent.schoolName}</span>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{siteContent.tagline}</p>
          </div>

          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Quick links</div>
            <ul className="mt-3 space-y-2">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[12.5px] text-muted hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Contact</div>
            <ul className="mt-3 space-y-1.5 text-[12.5px] text-muted">
              <li>{siteContent.contact.address}</li>
              {siteContent.contact.phones.map((phone) => (
                <li key={phone} className="font-mono">
                  {phone}
                </li>
              ))}
              {/* Footer stays to the one general address — every labeled
                  inbox (Admissions/Careers/etc.) is listed in full on the
                  Careers & Contact page. */}
              <li className="font-mono">{siteContent.contact.emails[0]?.value}</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border px-5 py-4 text-center text-[11px] text-muted">
          © {new Date().getFullYear()} {siteContent.schoolName}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
