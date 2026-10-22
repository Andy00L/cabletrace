// Types for the parts of tube.mjs (the Anatomy kit, MIT, see ./LICENSE) that the anchor figure calls, written from
// the kit's own reference (references/kit.md, section 11). The module itself is plain JavaScript.
import type { Point3, Projection } from "./iso-kit";

export type TubeRings = { pitch?: number; twist?: number; cross?: boolean; fade?: [number, number]; phase?: number; steps?: number; tone?: "hi" | "mid" | "lo" | "faint" };
export type TubePiece = { mid: Point3; points: Point3[]; radii: number[]; wide: boolean; from: number; to: number };

export function tubePieces(
  points3: Point3[],
  radius: number | ((share: number) => number),
  P: Projection,
  options?: { maxLength?: number; spacing?: number; closed?: boolean; breaks?: number[]; gaps?: [number, number][]; caps?: boolean | [boolean, boolean]; stripes?: boolean | "auto"; rings?: TubeRings | null },
): TubePiece[];
export function tubeSvg(piece: TubePiece, options?: { tone?: "hi" | "mid" | "lo" | "faint" }): string;
