import { MARITIME_IDENTIFICATION_DIGITS } from "@/lib/globe/maritime-identification-digits";

// The flag a ship's MMSI implies. A ship station's MMSI starts with the three Maritime Identification Digits of the
// administration that assigned it, normally the flag state (ITU table: src/lib/globe/maritime-identification-digits.ts).
// Other kinds of station (coast stations, aids to navigation, beacons, craft tied to a parent ship) start with 0, 1, 8
// or 9 and say nothing reliable about a flag here, so the card shows none for them.

export type FlagReading =
  | { kind: "flag"; mid: number; administration: string }
  /** The digits are in a ship station's range, but ITU lists no administration for them. */
  | { kind: "unassigned"; mid: number }
  | { kind: "not-a-ship-station" };

const SHIP_STATION_MMSI = /^[2-7]\d{8}$/;

export function readFlagFromMmsi(mmsi: number): FlagReading {
  const digits = String(mmsi);
  if (!SHIP_STATION_MMSI.test(digits)) return { kind: "not-a-ship-station" };
  const mid = Number(digits.slice(0, 3));
  const administration = MARITIME_IDENTIFICATION_DIGITS.get(mid);
  return administration === undefined ? { kind: "unassigned", mid } : { kind: "flag", mid, administration };
}

/** "Finland, MID 230", "MID 200, not assigned by ITU", or null when the number is not a ship station's. */
export function describeFlag(reading: FlagReading): string | null {
  switch (reading.kind) {
    case "flag":
      return `${reading.administration}, MID ${reading.mid}`;
    case "unassigned":
      return `MID ${reading.mid}, not assigned by ITU`;
    case "not-a-ship-station":
      return null;
    default: {
      const unhandled: never = reading;
      return unhandled;
    }
  }
}
