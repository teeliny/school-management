import type { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center">{children}</main>;
}
