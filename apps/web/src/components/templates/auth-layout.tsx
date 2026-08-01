import type { ReactNode } from "react";
import { ThemeToggle } from "../molecules/theme-toggle";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center p-5">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {children}
    </main>
  );
}
