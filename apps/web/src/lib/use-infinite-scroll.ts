"use client";

import { useEffect, useRef } from "react";

// Attach `sentinelRef` to an empty div at the bottom of a scrollable list —
// `onLoadMore` fires once it scrolls into view, as long as there's more to
// load and nothing is already in flight.
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  loading,
  root = null,
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  root?: Element | null;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root, rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loading, root]);

  return sentinelRef;
}
