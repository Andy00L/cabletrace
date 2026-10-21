import { CABLE_CASES } from "@/data/cases";
import { toReplaySceneInput } from "@/lib/cases/case-file";
import { loadCaseSketch } from "@/lib/cases/load-case-sketch";

// The case switcher's sketches, every case in one answer, built at build time (loadCaseSketch is cached). The console
// fetches it when a reader reaches for the switcher, so a case page no longer carries ten maps it does not draw
// (195 KB of the Eagle S page's 334 KB payload before, 20 Oct 2026).
export async function GET() {
  const sketches = await Promise.all(CABLE_CASES.map((cableCase) => loadCaseSketch(toReplaySceneInput(cableCase))));
  return Response.json(Object.fromEntries(CABLE_CASES.map((cableCase, index) => [cableCase.slug, sketches[index] ?? null])));
}
