import type { CableCase } from "@/lib/cases/case-file";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { FITBURG_2025 } from "@/data/cases/fitburg-2025";
import { HAI_HONG_GONG_66_2026 } from "@/data/cases/hai-hong-gong-66-2026";
import { HONG_TAI_58_2025 } from "@/data/cases/hong-tai-58-2025";
import { MINLIANYU_60138_2025 } from "@/data/cases/minlianyu-60138-2025";
import { NEWNEW_POLAR_BEAR_2023 } from "@/data/cases/newnew-polar-bear-2023";
import { SVALBARD_2022 } from "@/data/cases/svalbard-2022";
import { VEZHEN_2025 } from "@/data/cases/vezhen-2025";
import { YI_PENG_3_2024 } from "@/data/cases/yi-peng-3-2024";

/** Every published case, newest incident first. */
export const CABLE_CASES: readonly CableCase[] = [
  HAI_HONG_GONG_66_2026,
  FITBURG_2025,
  MINLIANYU_60138_2025,
  HONG_TAI_58_2025,
  VEZHEN_2025,
  EAGLE_S_2024,
  YI_PENG_3_2024,
  NEWNEW_POLAR_BEAR_2023,
  SVALBARD_2022,
];

export function findCableCase(slug: string): CableCase | null {
  return CABLE_CASES.find((cableCase) => cableCase.slug === slug) ?? null;
}
