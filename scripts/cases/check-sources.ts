// Checks that every source every case cites can still be read: resolves each original address and its archived
// copy over the network (HEAD, then GET when HEAD is refused or fails, redirects followed).
// Usage: bun scripts/cases/check-sources.ts
// A source fails when it has no archived copy or its archived copy does not answer, so a dead original always has
// a live archive behind it. Originals that refuse automated readers (401, 403, 429) are listed apart from dead ones:
// a browser usually opens them. Static checks (snapshot address shape, capture date, duplicate ids) live in
// findCaseProblems (src/lib/cases/case-file.ts) and run with `bun test src`.
// Exit codes: 0 every source passes, 1 a source failed, 2 the check could not run (no network).
import { CABLE_CASES } from "../../src/data/cases";
import type { CaseSource } from "../../src/lib/cases/case-file";

const USER_AGENT = "CableTrace source check (+https://github.com/Andy00L/cabletrace)";
// Per request (HEAD or GET), in milliseconds.
const REQUEST_TIMEOUT_MS = 20_000;
// Requests in flight at once, all hosts together.
const MAX_CONCURRENT_REQUESTS = 4;
// Statuses a server answers when it turns away automated readers rather than when the page is gone.
const REFUSAL_STATUSES = new Set([401, 403, 429]);
// The Wayback Machine answers 429 when it is read too fast; a refused archive is asked again after a pause.
const ARCHIVE_RETRY_DELAYS_MS = [15_000, 45_000];
// Answers when the network itself works; if it does not, the run stops with exit code 2 instead of failing every
// source.
const NETWORK_PROBE_URL = "https://web.archive.org/";

/** What one address answered after redirects. */
type Reach =
  | { kind: "live"; status: number; finalUrl: string }
  | { kind: "refused"; status: number }
  | { kind: "dead"; reason: string };

type SourceRow = { caseSlug: string; source: CaseSource; original: Reach; archive: Reach | null };

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function describeReach(reach: Reach): string {
  switch (reach.kind) {
    case "live":
      return `live (${reach.status})`;
    case "refused":
      return `refused (${reach.status})`;
    case "dead":
      return `dead (${reach.reason})`;
    default: {
      const unhandledReach: never = reach;
      return unhandledReach;
    }
  }
}

function classifyStatus(status: number, finalUrl: string): Reach {
  if (status >= 200 && status < 300) return { kind: "live", status, finalUrl };
  if (REFUSAL_STATUSES.has(status)) return { kind: "refused", status };
  return { kind: "dead", reason: `HTTP ${status}` };
}

/** One request; network errors and timeouts come back as a dead reach. The body is never downloaded. */
async function request(url: string, method: "HEAD" | "GET"): Promise<Reach> {
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return classifyStatus(response.status, response.url || url);
  } catch (error) {
    return { kind: "dead", reason: describeError(error) };
  }
}

/** HEAD first; many servers refuse or mishandle HEAD, so anything but a live answer is asked again with GET. */
async function resolveAddress(url: string): Promise<Reach> {
  const headReach = await request(url, "HEAD");
  if (headReach.kind === "live") return headReach;
  const getReach = await request(url, "GET");
  // A GET that fails at the network level says less than the HEAD's HTTP status, if the HEAD got one.
  return getReach.kind === "dead" && headReach.kind !== "dead" ? headReach : getReach;
}

async function resolveArchive(url: string): Promise<Reach> {
  let reach = await resolveAddress(url);
  for (const delayMs of ARCHIVE_RETRY_DELAYS_MS) {
    if (reach.kind !== "refused") break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    reach = await resolveAddress(url);
  }
  // A capture that redirects out of the archive (to a login or a home page) does not hold the cited page.
  if (reach.kind === "live" && !/^https:\/\/(web\.archive\.org\/web\/|archive\.(today|ph|is|li|vn|fo|md)\/)/.test(reach.finalUrl)) {
    return { kind: "dead", reason: `redirected out of the archive to ${reach.finalUrl}` };
  }
  return reach;
}

/** Runs `tasks` with at most `limit` in flight, keeping their order in the result. */
async function runPooled<TValue>(tasks: (() => Promise<TValue>)[], limit: number): Promise<TValue[]> {
  const results: TValue[] = new Array(tasks.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex;
      nextIndex += 1;
      const task = tasks[taskIndex];
      if (task) results[taskIndex] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runWorker));
  return results;
}

async function main(): Promise<number> {
  const probe = await request(NETWORK_PROBE_URL, "HEAD");
  if (probe.kind === "dead") {
    console.error(`[checkSources] the network check failed, ${NETWORK_PROBE_URL} is ${describeReach(probe)}`);
    return 2;
  }

  const entries = CABLE_CASES.flatMap((cableCase) => cableCase.sources.map((source) => ({ caseSlug: cableCase.slug, source })));
  // Two cases citing the same page resolve it once.
  const originalUrls = [...new Set(entries.map((entry) => entry.source.url))];
  const archiveUrls = [...new Set(entries.flatMap((entry) => (entry.source.archivedUrl === null ? [] : [entry.source.archivedUrl])))];
  console.log(`[checkSources] ${entries.length} sources in ${CABLE_CASES.length} cases: ${originalUrls.length} original addresses, ${archiveUrls.length} archived copies`);
  const startedMs = performance.now();
  const reaches = await runPooled(
    [...originalUrls.map((url) => () => resolveAddress(url)), ...archiveUrls.map((url) => () => resolveArchive(url))],
    MAX_CONCURRENT_REQUESTS,
  );
  const reachByUrl = new Map<string, Reach>();
  [...originalUrls, ...archiveUrls].forEach((url, index) => {
    const reach = reaches[index];
    if (reach) reachByUrl.set(url, reach);
  });
  const rows: SourceRow[] = entries.map(({ caseSlug, source }) => ({
    caseSlug,
    source,
    original: reachByUrl.get(source.url) ?? { kind: "dead", reason: "not checked" },
    archive: source.archivedUrl === null ? null : (reachByUrl.get(source.archivedUrl) ?? { kind: "dead", reason: "not checked" }),
  }));

  const label = (row: SourceRow) => `${row.caseSlug} source ${row.source.id} (${row.source.publisher})`;
  const failures = rows.flatMap((row) => {
    if (row.archive === null) return [`${label(row)}: no archived copy; original ${describeReach(row.original)} ${row.source.url}`];
    if (row.archive.kind !== "live") return [`${label(row)}: archived copy ${describeReach(row.archive)} ${row.source.archivedUrl}; original ${describeReach(row.original)}`];
    return [];
  });
  const refusedOriginals = rows.filter((row) => row.original.kind === "refused");
  const deadOriginals = rows.filter((row) => row.original.kind === "dead");
  const liveOriginals = rows.filter((row) => row.original.kind === "live");

  if (refusedOriginals.length > 0) {
    console.log(`[checkSources] originals that refuse automated readers (a browser usually opens them):`);
    refusedOriginals.forEach((row) => console.log(`[checkSources]   ${label(row)}: ${describeReach(row.original)} ${row.source.url}`));
  }
  if (deadOriginals.length > 0) {
    console.log(`[checkSources] originals that no longer answer:`);
    deadOriginals.forEach((row) => console.log(`[checkSources]   ${label(row)}: ${describeReach(row.original)} ${row.source.url}; archive ${row.archive ? describeReach(row.archive) : "none"}`));
  }
  if (failures.length > 0) {
    console.log(`[checkSources] failed:`);
    failures.forEach((failure) => console.log(`[checkSources]   ${failure}`));
  }
  const elapsedSeconds = Math.round((performance.now() - startedMs) / 1000);
  console.log(
    `[checkSources] originals: ${liveOriginals.length} live, ${refusedOriginals.length} refused, ${deadOriginals.length} dead. ` +
      `Archived copies: ${rows.filter((row) => row.archive?.kind === "live").length} live of ${rows.filter((row) => row.archive !== null).length}, ${rows.filter((row) => row.archive === null).length} sources without one. ${elapsedSeconds} s.`,
  );
  console.log(failures.length === 0 ? "[checkSources] every source passes" : `[checkSources] ${failures.length} source(s) failed`);
  return failures.length === 0 ? 0 : 1;
}

// Anything thrown past main is a broken run, not a finding: exit 2.
process.exit(
  await main().catch((error: unknown) => {
    console.error(`[checkSources] the run failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }),
);
