"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Wraps next-themes: toggles a `.dark` class on <html> (matches
 * tailwind.config.ts's `darkMode: "class"`), persists the choice, and
 * defaults to the OS preference. The inline script next-themes injects runs
 * before hydration, which is what avoids a flash of the wrong theme on load —
 * see the `suppressHydrationWarning` on <html> in layout.tsx, required
 * because of that same pre-hydration script.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
