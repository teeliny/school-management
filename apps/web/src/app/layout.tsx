import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School Management",
  description: "School management platform (Phase 0 scaffold)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
