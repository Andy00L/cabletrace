"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FigureStage } from "@/lib/landing/anchor-figure-model";

// The stage the page wants the anchor figure at, handed down to its live part. AnchorFigure renders on the server (it
// reads the case files), so a client section cannot pass it a changing prop; it wraps the figure in this instead.

const FigureStageContext = createContext<FigureStage | null>(null);

/**
 * Drives every AnchorFigure inside it to `stage` ("drop", "drag" or "cut"); each change plays the drag between the two
 * moments in 900 ms, or jumps under reduced motion.
 *
 *   <AnchorFigureStage stage={stage}>{figure}</AnchorFigureStage>   // figure = <AnchorFigure /> from a server file
 */
export function AnchorFigureStage({ stage, children }: { stage: FigureStage; children: ReactNode }) {
  return <FigureStageContext value={stage}>{children}</FigureStageContext>;
}

/** The stage an enclosing AnchorFigureStage asks for, or null when none does. */
export const useFigureStage = () => useContext(FigureStageContext);
