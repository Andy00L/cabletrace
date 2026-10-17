// Inputs and outputs of the anchor-drag detector. Pure data: the same types serve the Supabase edge function
// (Deno), the Bun backtest and the browser. AIS "not available" codes are already null in every input.

/** One AIS position report of one ship. */
export type TrackPoint = {
  atMs: number;
  longitude: number;
  latitude: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  /** ITU-R M.1371 navigational status code (0 under way using engine, 1 at anchor, 2 not under command, ...). */
  navigationStatus: number | null;
};

export type CableKind = "power" | "telecom" | "pipeline";

/** A cable or pipeline route as [longitude, latitude] vertices. */
export type CableLine = { name: string; kind: CableKind; coordinates: [number, number][] };

/** Water depth in metres at a point, negative below sea level, or null when the point is outside the grid. */
export type DepthLookup = (longitude: number, latitude: number) => number | null;

/** What AIS static data tells about the ship's size. Every field may be missing. */
export type ShipSize = {
  lengthMetres: number | null;
  beamMetres: number | null;
  draughtMetres: number | null;
  /** AIS ship and cargo type, 0 to 99. */
  shipType: number | null;
  /** AIS dimension A: GPS antenna to bow, in metres. */
  antennaFromBowMetres: number | null;
};

export type DetectorInput = {
  track: readonly TrackPoint[];
  cables: readonly CableLine[];
  depthAt: DepthLookup | null;
  ship: ShipSize | null;
};

/** A span of the track with no usable report, shown as a gap rather than filled in. */
export type TrackGap = { fromMs: number; toMs: number; cause: "silence" | "position-jump" };

export type EvidenceRule = "low-speed-under-way" | "straight-run" | "speed-deficit" | "speed-change-point" | "heading-offset" | "cable-contact";

type EvidenceBase<Rule extends EvidenceRule, Measured> = {
  rule: Rule;
  /** Share of the score this rule adds, 0 to 1 (the weights of every rule sum to 1). */
  weight: number;
  measured: Measured;
  /** One plain sentence that a reader can check against the measured numbers. */
  sentence: string;
};

export type Evidence =
  | EvidenceBase<"low-speed-under-way", { durationMinutes: number; medianSpeedKnots: number; speedSpreadKnots: number; reportCount: number }>
  | EvidenceBase<"straight-run", { straightDistanceKm: number; pathDistanceKm: number; straightness: number }>
  | EvidenceBase<
      "speed-deficit",
      { referenceSide: "before" | "after"; referenceSpeedKnots: number; runSpeedKnots: number; deficitFraction: number; stopMinutesBeforeResuming: number | null }
    >
  | EvidenceBase<"speed-change-point", { atMs: number; speedBeforeKnots: number; speedAfterKnots: number }>
  | EvidenceBase<"heading-offset", { runOffsetDegrees: number; referenceOffsetDegrees: number; shiftDegrees: number }>
  | EvidenceBase<"cable-contact", { crossingCount: number; cableNames: string[]; followedKm: number }>;

/** Where the anchor path meets a cable. The time band follows from the layback band. */
export type CableCrossing = {
  cableName: string;
  cableKind: CableKind;
  atMs: number;
  earliestMs: number;
  latestMs: number;
  longitude: number;
  latitude: number;
};

/** The reconstructed anchor position at one report time, with the along-track uncertainty of the layback. */
export type AnchorPoint = {
  atMs: number;
  longitude: number;
  latitude: number;
  /** Horizontal distance from the hawse pipe to the anchor along the track, in metres. */
  laybackMetres: number;
  laybackMinMetres: number;
  laybackMaxMetres: number;
  /** Water depth used for the chain shape, or null when the depth grid does not cover the point. */
  depthMetres: number | null;
};

/** The chain and anchor the model assumed, so a reader can redo the layback. */
export type AnchorModel = {
  equipmentNumber: number;
  anchorMassKg: number;
  chainDiameterMm: number;
  /** All the chain of one anchor (half of UR A1 Table 1's total), the nominal paid-out length. */
  chainPerAnchorMetres: number;
  /** The same over the ship-size band; with scope 6 times the depth, these bound the paid-out length. */
  chainPerAnchorMinMetres: number;
  chainPerAnchorMaxMetres: number;
  antennaFromBowMetres: number;
  /** Plain-language list of the assumptions behind the numbers above. */
  assumptions: string[];
};

export type DetectionLevel = "alert" | "watch";

export type Detection = {
  level: DetectionLevel;
  startMs: number;
  endMs: number;
  /** Sum of the weights of the rules that fired, 0 to 1. A rank, never a verdict. */
  score: number;
  evidence: Evidence[];
  cableCrossings: CableCrossing[];
  anchorPath: AnchorPoint[];
  anchorModel: AnchorModel;
  /** Gaps inside or next to the detection window, so a reader sees what the track does not show. */
  gaps: TrackGap[];
};

/** Everything the detector can say about one ship's track. Every branch is a complete answer. */
export type TrackAssessment =
  | { kind: "not-eligible"; reason: string }
  | { kind: "insufficient-data"; reason: string; reportCount: number; gaps: TrackGap[] }
  | { kind: "no-fit"; reportCount: number; gaps: TrackGap[] }
  | { kind: "fits"; reportCount: number; gaps: TrackGap[]; detections: [Detection, ...Detection[]] };
