import { CABLE_CASES } from "@/data/cases";
import { loadCaseFileExport } from "@/lib/cases/load-case-file";

// The case file download: every case is curated data in the repository, so each file is built once at build time.
export function generateStaticParams() {
  return CABLE_CASES.map((cableCase) => ({ slug: cableCase.slug }));
}

export async function GET(_request: Request, context: RouteContext<"/cases/[slug]/case-file">) {
  const { slug } = await context.params;
  const exported = await loadCaseFileExport(slug);
  if (!exported) return Response.json({ ok: false, reason: `no case ${slug}` }, { status: 404 });
  // Indented for a person reading it; the hash covers the canonical form, so the indentation does not matter.
  return new Response(JSON.stringify(exported, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="cabletrace-${exported.slug}.json"`,
      "X-Content-SHA256": exported.contentSha256,
    },
  });
}
