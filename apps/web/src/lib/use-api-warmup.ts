"use client";

import { useSyncExternalStore } from "react";
import { subscribe, getSnapshot, type WarmupState } from "./warmup-store";

export function useApiWarmup(): WarmupState {
  return useSyncExternalStore(subscribe, getSnapshot, () => ({ status: "idle" }));
}
