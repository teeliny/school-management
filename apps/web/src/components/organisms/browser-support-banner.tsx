"use client";

import { useEffect, useState } from "react";
import { isBrowserOutdated } from "../../lib/browser-support";

/**
 * Proactive warning for the browsers we know crash on login/dashboard (old
 * Android Chrome builds a device's OS no longer lets the Play Store update
 * past — see the school-portal login crash investigation). Feature-detected,
 * not user-agent sniffed, so it doesn't need updating as the exact broken
 * version varies per device. Rendered inside the root layout's fixed notice
 * stack (see layout.tsx), stacked below ApiWarmupBanner if both show.
 */
export function BrowserSupportBanner() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    setOutdated(isBrowserOutdated());
  }, []);

  if (!outdated) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-danger-bg px-4 py-2 text-center text-sm text-danger">
      Your browser is out of date and some pages on this site may not work correctly. Please update
      Chrome (or switch browsers) for the best experience.
    </div>
  );
}
