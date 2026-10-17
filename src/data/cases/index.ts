import type { CableCase } from "@/lib/cases/case-file";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { YI_PENG_3_2024 } from "@/data/cases/yi-peng-3-2024";
import { VEZHEN_2025 } from "@/data/cases/vezhen-2025";

/** Every published case, newest incident first. */
export const CABLE_CASES: readonly CableCase[] = [VEZHEN_2025, EAGLE_S_2024, YI_PENG_3_2024];

export function findCableCase(slug: string): CableCase | null {
  return CABLE_CASES.find((cableCase) => cableCase.slug === slug) ?? null;
}
