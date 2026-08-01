import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes, resolving conflicts (e.g. a consumer's className overriding a default padding). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
