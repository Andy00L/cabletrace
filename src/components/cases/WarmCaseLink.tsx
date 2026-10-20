"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { warmCaseArea } from "@/lib/seabed/warm-area";

// A pointer resting this long on a case link is intent; a pointer sweeping across the list warms nothing.
const HOVER_INTENT_MS = 120;

type WarmCaseLinkProps = {
  href: string;
  /** The case's seabed area (CableCase.seabedArea), warmed on intent. */
  area: string;
  className?: string;
  testId?: string;
  children: ReactNode;
};

/** A link to a case that starts loading its seabed area on hover intent, on press and on keyboard focus. */
export function WarmCaseLink({ href, area, className, testId, children }: WarmCaseLinkProps) {
  const hoverTimerRef = useRef<number | null>(null);
  const cancelHover = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  };
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId}
      onPointerEnter={() => {
        cancelHover();
        hoverTimerRef.current = window.setTimeout(() => warmCaseArea(area), HOVER_INTENT_MS);
      }}
      onPointerLeave={cancelHover}
      onPointerDown={() => {
        cancelHover();
        warmCaseArea(area);
      }}
      onFocus={() => warmCaseArea(area)}
    >
      {children}
    </Link>
  );
}
