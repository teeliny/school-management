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

  // Kept in a ref, not the effect's dependency array — a caller passing an
  // inline `() => loadMore()` (a fresh function every render, the common
  // case) would otherwise tear down and recreate the IntersectionObserver
  // on virtually every render. Since intersection callbacks are delivered
  // asynchronously, destroying the observer between "intersection detected"
  // and "callback delivered" silently drops that notification — the real
  // cause of "load more" firing inconsistently (once, or never at all)
  // rather than every time the sentinel scrolls into view. Reading the
  // latest callback through a ref keeps the observer's own lifecycle tied
  // only to hasMore/loading/root, while still always invoking the freshest
  // onLoadMore when it actually fires.
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMoreRef.current();
      },
      { root, rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, root]);

  return sentinelRef;
}
