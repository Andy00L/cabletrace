// Ship classes for the live globe, from the AIS "type of ship and cargo type" code.
// Source: ITU-R M.1371-5, Annex 8, Table 53 (identifiers to be used by ships to report their type).
// Type-only import: see the import rule at the top of snapshot-codec.ts.
import type { ShipClass } from "./snapshot-codec.ts";

/**
 * Maps an AIS ship type code (0-255) to a class. Null and 0 mean the ship did not report a type;
 * codes the table leaves reserved or that have no class of their own fall into "other".
 *   30 fishing, 31-32 towing and 52 tug, 35 military, 36 sailing, 37 pleasure craft, 50 pilot vessel,
 *   60-69 passenger, 70-79 cargo, 80-89 tanker.
 */
export function shipClassFromAisType(aisShipType: number | null): ShipClass {
  if (aisShipType === null || !Number.isInteger(aisShipType) || aisShipType <= 0 || aisShipType > 255) return "unknown";
  if (aisShipType === 30) return "fishing";
  if (aisShipType === 31 || aisShipType === 32 || aisShipType === 52) return "tug";
  if (aisShipType === 35) return "military";
  if (aisShipType === 36) return "sailing";
  if (aisShipType === 37) return "pleasure";
  if (aisShipType === 50) return "pilot";
  if (aisShipType >= 60 && aisShipType <= 69) return "passenger";
  if (aisShipType >= 70 && aisShipType <= 79) return "cargo";
  if (aisShipType >= 80 && aisShipType <= 89) return "tanker";
  return "other";
}
