"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { Card } from "./card";

export function CollapsibleCard({
  title,
  sub,
  action,
  defaultOpen = true,
  className,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={className}>
      <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen}>
        <div className="flex items-start justify-between gap-3">
          <CollapsiblePrimitive.Trigger className="group flex min-w-0 flex-1 items-start gap-2 text-left outline-none">
            <ChevronDown className="mt-[3px] h-4 w-4 flex-none text-muted transition-transform duration-150 group-data-[state=closed]:-rotate-90" />
            <div className="min-w-0">
              <h3 className="font-display text-[15.5px] font-semibold">{title}</h3>
              {sub && <div className="mt-0.5 text-[11.5px] text-muted">{sub}</div>}
            </div>
          </CollapsiblePrimitive.Trigger>
          {action}
        </div>
        <CollapsiblePrimitive.Content className="overflow-hidden data-[state=closed]:hidden">
          <div className={cn("pt-3.5", "[&>*]:min-w-0")}>{children}</div>
        </CollapsiblePrimitive.Content>
      </CollapsiblePrimitive.Root>
    </Card>
  );
}
