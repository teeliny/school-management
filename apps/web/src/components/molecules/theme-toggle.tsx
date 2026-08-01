"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Moon, Sun } from "lucide-react";

const itemClass =
  "flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors " +
  "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is undefined until mounted (depends on localStorage/OS
  // preference, neither available during SSR) — keep the group valueless
  // until then so server- and client-rendered output match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ToggleGroup.Root
      type="single"
      value={mounted ? resolvedTheme : undefined}
      onValueChange={(next) => next && setTheme(next)}
      aria-label="Theme"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 p-1"
    >
      <ToggleGroup.Item value="light" aria-label="Light mode" className={itemClass}>
        <Sun className="h-4 w-4" />
      </ToggleGroup.Item>
      <ToggleGroup.Item value="dark" aria-label="Dark mode" className={itemClass}>
        <Moon className="h-4 w-4" />
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}
