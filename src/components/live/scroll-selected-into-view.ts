"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a list's selected row (the one with aria-current) in view of the rail when the selection changes, so picking
 * a ship or a marker on the globe shows its row. `selectionKey` changes with the selection; null means none.
 */
export function useScrollSelectedIntoView(listRef: RefObject<HTMLElement | null>, selectionKey: string | number | null): void {
  // Syncs the rail's scroll position, browser state React does not own, with the selection.
  useEffect(() => {
    if (selectionKey === null) return;
    const row = listRef.current?.querySelector('[aria-current="true"]');
    if (!row) return;
    const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: isReduced ? "auto" : "smooth" });
  }, [listRef, selectionKey]);
}
