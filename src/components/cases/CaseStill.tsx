"use client";

import { useEffect, useState } from "react";
import { CaseSketchMap } from "@/components/cases/CaseCard";
import type { CaseSketch } from "@/lib/cases/case-sketch";
import { fetchCaseSketches } from "@/lib/cases/case-sketches-api";

/**
 * The case's sketch in place of the 3D view, for a browser that cannot draw it. It mounts only after the 3D view has
 * failed, so a case page never carries the sketch's land outline (about 48 KB) for the readers whose 3D view works.
 */
export function CaseStill({ slug, vesselName }: { slug: string; vesselName: string }) {
  const [sketch, setSketch] = useState<CaseSketch | null>(null);
  // Fetches the sketch from /cases/sketches, a server React does not own, once this fallback shows.
  useEffect(() => {
    let isCurrent = true;
    void fetchCaseSketches().then((outcome) => {
      if (!isCurrent) return;
      if (!outcome.ok) {
        console.error(`[CaseStill] ${outcome.reason}`);
        return;
      }
      setSketch(outcome.value.get(slug) ?? null);
    });
    return () => {
      isCurrent = false;
    };
  }, [slug]);
  return <div className="size-full bg-depth-40">{sketch && <CaseSketchMap sketch={sketch} vesselName={vesselName} />}</div>;
}
