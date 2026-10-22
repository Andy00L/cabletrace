import { buildFigureSvg } from "@/components/landing/anchor-figure-svg";
import { buildFigureView } from "@/components/landing/anchor-figure-view";
import { loadAnchorFigureFacts } from "@/lib/landing/load-anchor-figure-facts";

// GET /figures/anchor-figure.svg: the front page's anchor figure, every path of it, built once at build time from the
// case file and the replay series (the facts are cached; nothing here reads the request). The page fetches it when
// the figure nears the view, so its weight never rides in the page's HTML (docs/PERFORMANCE.md). The `.svg` ending
// keeps it outside the auth proxy's matcher (src/proxy.ts), like the files in public/.
export async function GET() {
  const facts = await loadAnchorFigureFacts();
  if (!facts.ok) {
    console.error(`[GET /figures/anchor-figure.svg] ${facts.reason}`);
    return new Response("The figure could not be built.", { status: 500 });
  }
  const svg = buildFigureSvg(facts.value, buildFigureView(facts.value));
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}
