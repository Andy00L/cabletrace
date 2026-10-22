import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSeries } from "@/lib/cases/load-case-series";
import { readAnchorFigureFacts, type AnchorFigureFacts } from "@/lib/landing/anchor-figure-model";
import type { Result } from "@/lib/result";

// The cut whose minute the figure reads its depth and speed from: the C-Lion1 cut, the one the evidence note explains.
const FIGURE_CUT_LABEL = "C-Lion1";

/**
 * The anchor figure's facts from the Eagle S case and its replay series (server only: the series is read from the
 * seabed files). The front page's card and the figure's SVG route both read them here, so the two always agree.
 */
export async function loadAnchorFigureFacts(): Promise<Result<AnchorFigureFacts>> {
  const series = await loadCaseSeries(toReplaySceneInput(EAGLE_S_2024));
  if (!series) return { ok: false, reason: "the Eagle S replay series could not be read" };
  return readAnchorFigureFacts({ cableCase: EAGLE_S_2024, cutLabel: FIGURE_CUT_LABEL, series });
}
