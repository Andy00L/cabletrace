// The outside judge of the fault-signal matcher (src/lib/fault-signals): replays published records and checks that
// they open the right draft case. Prints one table row per expectation and exits 0 when every expectation holds,
// 1 when one fails, 2 when the replay could not run (a fixture or a seabed file missing or unreadable).
// Usage, from the repository root: bun scripts/fault-signals/replay-known.ts
//
// Estlink 2, 25 Dec 2024: Fingrid's notice (scripts/fault-signals/fixtures/fingrid-estlink-2-notice.json) and Fingrid's
// Nord Pool market message (src/lib/fault-signals/fixtures/nordpool-umm-estlink-2-v2.json) must each match Estlink 2
// alone and open a draft that ranks Eagle S first. The ENTSO-E record needs a token CableTrace does not have yet (the
// API answered 401 on 17 Oct 2026); the market message is the same REMIT publication. Ship data: the three positions
// of the Eagle S case file plus the decoys of decoy-ships.ts. What this proves and what it cannot is printed at the end.
// NGA, 17 Oct 2026: the active cable warnings must be kept or dropped as read by hand, with every position, and match
// no registry cable (none lies in the Baltic).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import type { ShipTrack } from "@/lib/detection/detection-inputs";
import type { CableLine, DepthLookup, ShipSize } from "@/lib/detection/detection-types";
import type { Result } from "@/lib/result";
import { distanceToCableMetres, matchSignalToCables, type CableMatch } from "@/lib/fault-signals/cable-matcher";
import {
  DRAFT_LOOKBACK_MS,
  DRAFT_NEAR_CABLE_METRES,
  FAULT_TIME_SLACK_MS,
  buildDraftCase,
  draftWindowFor,
  isNarrowerFaultSpan,
  splitShipsForDraft,
  type DraftCase,
} from "@/lib/fault-signals/draft-case";
import type { FaultSignal, RegistryCable } from "@/lib/fault-signals/fault-signal-types";
import { parseNgaWarnings } from "@/lib/fault-signals/nga-warnings";
import { parseUmmMessage } from "@/lib/fault-signals/nordpool-umm";
import { signalFromOperatorNotice, type OperatorNoticeReading } from "@/lib/fault-signals/operator-notice";
import { loadSeabedInputs } from "../backtest/seabed-inputs";
import { buildDecoyShips } from "./decoy-ships";

const NOTICE_FIXTURE = "scripts/fault-signals/fixtures/fingrid-estlink-2-notice.json";
const UMM_FIXTURE = "src/lib/fault-signals/fixtures/nordpool-umm-estlink-2-v2.json";
const NGA_FIXTURE = "src/lib/fault-signals/fixtures/nga-active-warnings-2026-10-17.json";
const AFFECTED_CABLE = "HVDC Estlink 2";

// Fingrid's notice read by hand. Finland was on EET (UTC+2) on 25 Dec 2024: "after noon on Christmas Day" is after
// 10:00 UTC and before the day ended at 22:00 UTC.
const FINGRID_READING: OperatorNoticeReading = {
  assetNames: ["EstLink 2"],
  assetQuote: "The EstLink 2 electricity transmission connection between Finland and Estonia disconnected from the grid",
  countries: ["FI", "EE"],
  countriesQuote: "between Finland and Estonia",
  faultNotBeforeUtc: "2024-12-25T10:00:00Z",
  faultNotAfterUtc: "2024-12-25T22:00:00Z",
  faultTimeQuote: "disconnected from the grid after noon on Christmas Day",
};

// Eagle S: 228.6 m oil tanker (src/data/cases/eagle-s-2024.ts, vessel.type); AIS type 80 is "tanker, all ships of this
// type" (ITU-R M.1371-5, Table 53), the same size scripts/backtest/run-backtest.ts gives the detector.
const EAGLE_S_SHIP: ShipSize = { lengthMetres: 228.6, beamMetres: 32, draughtMetres: null, shipType: 80, antennaFromBowMetres: null };

// The NGA warnings of the fixture, read by hand before the parser ran: the ones about cable work, with the number of
// positions in each trackline or area, and the reason each other warning is not about cable work.
const NGA_KEPT_BY_HAND: Readonly<Record<string, string>> = {
  "NAVAREA IV 127/24": "tracklines 4+3",
  "HYDROLANT 950/24": "tracklines 8",
  "HYDROLANT 928/24": "tracklines 8",
  "HYDROLANT 881/24": "area 14",
  "HYDROLANT 2905/23": "tracklines 12",
  "HYDROPAC 1561/24": "area 5",
  "HYDROPAC 1558/24": "tracklines 2",
  "HYDROPAC 1519/24": "tracklines 3",
  "HYDROPAC 942/24": "tracklines 2",
  "HYDROPAC 334/24": "tracklines 15",
  "HYDROPAC 3390/23": "tracklines 8",
  "HYDROPAC 2939/23": "tracklines 5",
  "HYDROPAC 2918/23": "points 1",
  "HYDROPAC 2153/23": "area 10",
};
const NGA_DROPPED_BY_HAND: Readonly<Record<string, string>> = {
  "HYDROLANT 827/24": "seismic streamers",
  "HYDROLANT 743/24": "seismic streamers",
  "HYDROLANT 444/24": "seismic streamers",
  "HYDROLANT 360/24": "seismic streamers",
  "HYDROLANT 1757/23": "seismic streamers",
  "HYDROPAC 1525/24": "seismic streamers",
  "HYDROPAC 710/24": "seismic streamers",
  "HYDROARC 64/24": "seismic streamers",
  "HYDROPAC 1565/24": "man overboard from a cable ship",
  "HYDROPAC 864/24": "standing prohibited area over cables",
  "HYDROARC 262/22": "a shoal, no cable",
  "NAVAREA IV 1404/23": "an unlit lighthouse, no cable",
};
const METRES_PER_KM = 1000;
// No two points on Earth lie farther apart than half its circumference (about 20,015 km on the mean sphere).
const HALF_EARTH_CIRCUMFERENCE_METRES = 20_015_087;

type Row = { check: string; expectation: string; measured: string; passed: boolean };
type Registry = { cables: RegistryCable[]; linesByName: Map<string, CableLine[]>; depthAt: DepthLookup };

function formatUtc(atMs: number): string {
  return `${new Date(atMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

async function readJson(relativePath: string): Promise<Result<unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(process.cwd(), relativePath), "utf8"));
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, reason: `${relativePath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The registry as the seabed files map it (the same OpenStreetMap and EMODnet routes as public.cables). */
async function loadRegistry(): Promise<Result<Registry>> {
  const gulf = await loadSeabedInputs("gulf-of-finland");
  const baltic = await loadSeabedInputs("baltic-proper");
  if (!gulf.ok) return gulf;
  if (!baltic.ok) return baltic;
  const linesByName = new Map<string, CableLine[]>();
  for (const line of [...gulf.value.cables, ...baltic.value.cables]) linesByName.set(line.name, [...(linesByName.get(line.name) ?? []), line]);
  const cables = [...linesByName.entries()].map(([name, lines], index) => ({
    id: index + 1,
    name,
    kind: lines[0]?.kind ?? "telecom",
    lines: lines.map((line) => line.coordinates),
    // Landing countries live in public.cable_landing_countries; only the border fallback reads them, and no record here needs it.
    countries: [],
  }));
  return { ok: true, value: { cables, linesByName, depthAt: gulf.value.depthAt } };
}

function eagleSTrack(): ShipTrack {
  return {
    mmsi: Number(EAGLE_S_2024.vessel.mmsi),
    ship: EAGLE_S_SHIP,
    track: EAGLE_S_2024.track.map((position) => ({
      atMs: Date.parse(position.atUtc),
      longitude: position.longitude,
      latitude: position.latitude,
      speedKnots: null,
      courseDegrees: null,
      headingDegrees: null,
      navigationStatus: null,
    })),
  };
}

function describeMatches(matches: readonly CableMatch[]): string {
  return matches.length === 0 ? "no cable" : matches.map((match) => `${match.cableName} (${match.basis})`).join(", ");
}

function openDraft(signal: FaultSignal, registry: Registry): DraftCase | null {
  const cable = registry.linesByName.get(AFFECTED_CABLE);
  if (!cable) return null;
  const window = draftWindowFor(signal);
  const decoys = buildDecoyShips();
  const names = new Map<number, string>([[Number(EAGLE_S_2024.vessel.mmsi), EAGLE_S_2024.vessel.name], ...decoys.map((decoy): [number, string] => [decoy.mmsi, decoy.name])]);
  const split = splitShipsForDraft({ tracks: [eagleSTrack(), ...decoys], cable, window, nearMetres: DRAFT_NEAR_CABLE_METRES });
  return buildDraftCase({ signal, cable, cableName: AFFECTED_CABLE, window, nearMetres: DRAFT_NEAR_CABLE_METRES, candidates: split.candidates, passers: split.passers, names, depthAt: registry.depthAt });
}

/**
 * What a record must do with Eagle S: rank it first, or (for a record that gives hours rather than a minute) rank it
 * first among the ships recorded at the cable in the fault span that the detector cannot judge, with only ships whose
 * anchor path crosses the cable inside that span above it.
 */
type EagleSExpectation = "first" | "first-unjudged-at-fault";

function checkEagleSRank(draft: DraftCase, expectation: EagleSExpectation): Row {
  const eagleS = draft.ships.find((ship) => ship.mmsi === Number(EAGLE_S_2024.vessel.mmsi));
  const above = draft.ships.filter((ship) => eagleS !== undefined && ship.rank < eagleS.rank);
  const measured = eagleS
    ? `rank ${eagleS.rank} (${eagleS.basis}), ${eagleS.closestApproachMetres} m from the cable at ${formatUtc(eagleS.closestApproachAtMs)}${above.length > 0 ? `; above it: ${above.map((ship) => `${ship.name} (${ship.basis}, crossing ${ship.crossingAtMs === null ? "none" : formatUtc(ship.crossingAtMs)})`).join(", ")}` : ""}`
    : "not in the draft";
  if (expectation === "first") return { check: "Eagle S", expectation: "ranked first", measured, passed: eagleS?.rank === 1 };
  return {
    check: "Eagle S",
    expectation: "first ship at the cable in the fault span that the detector cannot judge; above it only anchor paths crossing the cable in that span",
    measured,
    passed: eagleS?.basis === "unjudged-at-fault" && above.every((ship) => ship.basis === "drag-at-fault"),
  };
}

function checkEstlinkSignal(label: string, signal: FaultSignal, registry: Registry, eagleSExpectation: EagleSExpectation): { rows: Row[]; draft: DraftCase | null } {
  const matches = matchSignalToCables(signal, registry.cables);
  const rows: Row[] = [
    {
      check: `${label}, match`,
      expectation: `${AFFECTED_CABLE} alone, by name, opening a draft`,
      measured: describeMatches(matches),
      passed: matches.length === 1 && matches[0]?.cableName === AFFECTED_CABLE && matches[0]?.basis === "asset-name" && matches[0]?.opensDraft === true,
    },
  ];
  const draft = openDraft(signal, registry);
  if (!draft) return { rows: [...rows, { check: `${label}, draft`, expectation: "a draft case", measured: `${AFFECTED_CABLE} is not in the seabed files`, passed: false }], draft };
  const ranks = new Map(draft.ships.map((ship) => [ship.mmsi, ship]));
  const eagleSRank = ranks.get(Number(EAGLE_S_2024.vessel.mmsi))?.rank ?? Number.POSITIVE_INFINITY;
  const decoys = buildDecoyShips();
  const decoyRank = (mmsi: number) => ranks.get(mmsi)?.rank ?? null;
  const isAfternoonInWindow = Date.parse("2024-12-25T14:30:00Z") <= draft.window.toMs;
  const tug = ranks.get(999000004);
  const eagleSRow = checkEagleSRank(draft, eagleSExpectation);
  rows.push(
    {
      check: `${label}, window`,
      expectation: "starts 6 h before the earliest fault time, ends 15 min after the latest",
      measured: `${formatUtc(draft.window.fromMs)} to ${formatUtc(draft.window.toMs)}, ${draft.shipCount} ships within ${draft.nearMetres / METRES_PER_KM} km`,
      passed: draft.window.fromMs === signal.faultNotBeforeMs - DRAFT_LOOKBACK_MS && draft.window.toMs === signal.faultNotAfterMs + FAULT_TIME_SLACK_MS,
    },
    {
      check: `${label}, label`,
      expectation: "status draft",
      measured: draft.status,
      passed: draft.status === "draft",
    },
    { ...eagleSRow, check: `${label}, ${eagleSRow.check}` },
    {
      check: `${label}, decoys left out`,
      expectation: `the far lane always${isAfternoonInWindow ? "" : ", the afternoon crossing (after the window)"}`,
      measured: `far lane ${decoyRank(999000006) === null ? "left out" : `rank ${decoyRank(999000006)}`}, afternoon crossing ${decoyRank(999000007) === null ? "left out" : `rank ${decoyRank(999000007)}`}`,
      passed: decoyRank(999000006) === null && (isAfternoonInWindow ? decoyRank(999000007) !== null : decoyRank(999000007) === null),
    },
    {
      check: `${label}, decoys kept`,
      expectation: "the westbound, eastbound, slow, anchored and tug decoys, all below Eagle S, the tug last",
      measured: decoys
        .filter((decoy) => [999000001, 999000002, 999000003, 999000004, 999000005].includes(decoy.mmsi))
        .map((decoy) => `${decoy.name}: ${ranks.get(decoy.mmsi) ? `rank ${ranks.get(decoy.mmsi)?.rank} (${ranks.get(decoy.mmsi)?.basis})` : "missing"}`)
        .join("; "),
      passed: [999000001, 999000002, 999000003, 999000005].every((mmsi) => (decoyRank(mmsi) ?? 0) > eagleSRank) && tug?.rank === draft.ships.length && tug.basis === "not-eligible",
    },
  );
  return { rows, draft };
}

function checkNga(payload: unknown, registry: Registry): Row[] {
  const parsed = parseNgaWarnings(payload);
  if (!parsed.ok) return [{ check: "NGA, parse", expectation: "the fixture parses", measured: parsed.reason, passed: false }];
  const keptIds = parsed.value.signals.map((signal) => signal.externalId).sort();
  const droppedIds = parsed.value.dropped.map((dropped) => dropped.externalId).sort();
  const expectedKept = Object.keys(NGA_KEPT_BY_HAND).sort();
  const expectedDropped = Object.keys(NGA_DROPPED_BY_HAND).sort();
  const geometryMismatches = parsed.value.signals.flatMap((signal) => {
    const geometry = signal.locator.kind === "geometry" ? signal.locator.geometry : null;
    const described =
      geometry?.kind === "tracklines" ? `tracklines ${geometry.lines.map((line) => line.length).join("+")}` : geometry?.kind === "area" ? `area ${geometry.ring.length}` : geometry?.kind === "points" ? `points ${geometry.points.length}` : "none";
    return described === NGA_KEPT_BY_HAND[signal.externalId] ? [] : [`${signal.externalId}: ${described}, by hand ${NGA_KEPT_BY_HAND[signal.externalId] ?? "dropped"}`];
  });
  const matched = parsed.value.signals.flatMap((signal) => matchSignalToCables(signal, registry.cables).map((match) => `${signal.externalId} to ${match.cableName}`));
  // How far the nearest kept warning lies from any registry cable, to show the zero is not a broken matcher.
  const geometries = parsed.value.signals.flatMap((signal) => (signal.locator.kind === "geometry" ? [signal.locator.geometry] : []));
  const nearestMetres = Math.min(...geometries.flatMap((geometry) => registry.cables.map((cable) => distanceToCableMetres(geometry, cable.lines, HALF_EARTH_CIRCUMFERENCE_METRES) ?? Number.POSITIVE_INFINITY)));
  const nearestKm = nearestMetres / METRES_PER_KM;
  return [
    {
      check: "NGA 17 Oct 2026, cable warnings kept",
      expectation: `${expectedKept.length} kept, the ones read by hand`,
      measured: `${keptIds.length} kept${keptIds.join() === expectedKept.join() ? ", the same ones" : `: ${keptIds.join(", ")}`}`,
      passed: keptIds.join() === expectedKept.join(),
    },
    {
      check: "NGA 17 Oct 2026, other warnings dropped",
      expectation: `${expectedDropped.length} dropped (streamers, rescue, standing area, no cable)`,
      measured: `${droppedIds.length} dropped: ${parsed.value.dropped.map((dropped) => `${dropped.externalId} (${dropped.reason})`).join("; ")}`,
      passed: droppedIds.join() === expectedDropped.join(),
    },
    {
      check: "NGA 17 Oct 2026, positions",
      expectation: "every trackline and area has the positions counted by hand",
      measured: geometryMismatches.length === 0 ? `all ${keptIds.length} match` : geometryMismatches.join("; "),
      passed: geometryMismatches.length === 0,
    },
    {
      check: "NGA 17 Oct 2026, cables matched",
      expectation: "none: no warning lies in the Baltic",
      measured: `${matched.length === 0 ? "none" : matched.join(", ")}; the nearest warning lies ${Math.round(nearestKm)} km from a registry cable`,
      passed: matched.length === 0,
    },
  ];
}

function printTable(rows: readonly Row[]): void {
  const checkWidth = Math.max(5, ...rows.map((row) => row.check.length));
  const lines = rows.map((row) => `${row.passed ? "PASS" : "FAIL"} | ${row.check.padEnd(checkWidth)} | ${row.expectation} | ${row.measured}`);
  process.stdout.write(`${["Result | Check | Expectation | Measured", ...lines].join("\n")}\n`);
}

function printDraft(label: string, draft: DraftCase): void {
  const lines = draft.ships.map(
    (ship) => `  ${String(ship.rank).padStart(2)}. ${(ship.name ?? String(ship.mmsi)).padEnd(26)} ${ship.basis.padEnd(18)} closest ${String(ship.closestApproachMetres).padStart(5)} m at ${formatUtc(ship.closestApproachAtMs)}  ${ship.sentences[0] ?? ""}`,
  );
  process.stdout.write(`\nDraft case (${label}), ${draft.cableName}, ${formatUtc(draft.window.fromMs)} to ${formatUtc(draft.window.toMs)}:\n${lines.join("\n")}\n`);
}

async function main(): Promise<number> {
  const [notice, umm, nga, registry] = await Promise.all([readJson(NOTICE_FIXTURE), readJson(UMM_FIXTURE), readJson(NGA_FIXTURE), loadRegistry()]);
  if (!notice.ok || !umm.ok || !nga.ok || !registry.ok) {
    const reasons = [notice, umm, nga, registry].flatMap((loaded) => (loaded.ok ? [] : [loaded.reason]));
    console.error(`[main] the replay could not read its inputs: ${reasons.join("; ")}`);
    return 2;
  }
  const noticeSignal = signalFromOperatorNotice(notice.value, FINGRID_READING);
  const ummMessage = typeof umm.value === "object" && umm.value !== null && "message" in umm.value ? umm.value.message : null;
  const ummSignal = parseUmmMessage(ummMessage);
  if (!noticeSignal.ok || !ummSignal.ok) {
    console.error(`[main] a fixture did not parse: ${!noticeSignal.ok ? noticeSignal.reason : ""} ${!ummSignal.ok ? ummSignal.reason : ""}`);
    return 2;
  }
  const noticeResult = checkEstlinkSignal("Fingrid notice", noticeSignal.value, registry.value, "first-unjudged-at-fault");
  const ummResult = checkEstlinkSignal("Nord Pool UMM v2", ummSignal.value, registry.value, "first");
  // Both records concern one cable within a day, so the database keeps one draft with the ranking of the tighter span.
  const kept = isNarrowerFaultSpan(noticeSignal.value, ummSignal.value) ? noticeResult.draft : ummResult.draft;
  const mergedRow: Row = kept
    ? { ...checkEagleSRank(kept, "first"), check: "Both records, one draft (the tighter span's ranking)" }
    : { check: "Both records, one draft", expectation: "a draft", measured: "no draft", passed: false };
  const rows = [...noticeResult.rows, ...ummResult.rows, mergedRow, ...checkNga(nga.value, registry.value)];
  printTable(rows);
  if (ummResult.draft) printDraft("Nord Pool UMM v2, trip at 10:26 UTC", ummResult.draft);
  if (noticeResult.draft) printDraft("Fingrid notice, after noon EET", noticeResult.draft);
  process.stdout.write(
    "\nWhat this proves: each record finds Estlink 2 and only it, the window and the ship selection follow the stated rules, and the ranking puts a ship that sat on the cable at the trip and cannot be cleared above ordinary traffic." +
      "\nWhat it cannot prove: Eagle S has no surviving AIS. Its three positions were placed on the cables at the fault times from statements (src/data/cases/eagle-s-2024.ts), so its rank comes from those placements, and the detector itself can only call its track insufficient.\n",
  );
  const failedCount = rows.filter((row) => !row.passed).length;
  console.log(`[main] ${rows.length - failedCount} of ${rows.length} expectations hold`);
  return failedCount === 0 ? 0 : 1;
}

process.exit(await main());
