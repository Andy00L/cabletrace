import type { SeabedLineKind } from "@/lib/seabed/seabed-data";

/** A cable or pipeline the replays draw, for the globe: its points as a flat [longitude, latitude, ...] array. */
export type WatchedLine = { name: string; kind: SeabedLineKind; points: number[] };
