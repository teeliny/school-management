"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../atoms/button";

/**
 * The 5 generated report-comment suggestions under a comment Textarea.
 * Clicking one hands it to `onSelect`, which replaces the Textarea's text.
 * Nothing is saved until the user presses the panel's own Save.
 */
export function CommentSuggestions({
  suggestions,
  selected,
  source,
  loading,
  disabled,
  onSelect,
  onRegenerate,
}: {
  suggestions: string[];
  /** The Textarea's current text — a suggestion matching it is highlighted. */
  selected: string;
  source?: "template" | "llm";
  loading?: boolean;
  disabled?: boolean;
  onSelect: (comment: string) => void;
  onRegenerate: () => void;
}) {
  if (suggestions.length === 0 && !loading) return null;
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted">
          <Sparkles className="h-3 w-3" aria-hidden />
          Suggested comments
          {source && <span className="font-normal normal-case">· {source === "llm" ? "AI" : "Template"}</span>}
        </p>
        <Button type="button" size="sm" variant="outline" disabled={disabled || loading} onClick={onRegenerate}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
          Regenerate
        </Button>
      </div>
      <ul className="space-y-1">
        {suggestions.map((suggestion) => {
          const isSelected = suggestion === selected.trim();
          return (
            <li key={suggestion}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(suggestion)}
                aria-pressed={isSelected}
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card-inset text-foreground hover:border-primary/60",
                )}
              >
                {suggestion}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
