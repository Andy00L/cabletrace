import type { Region } from "@/lib/regions/region";
import { CENTRAL_BALTIC } from "@/data/regions/central-baltic";
import { DANISH_STRAITS_KATTEGAT } from "@/data/regions/danish-straits-kattegat";
import { ENGLISH_CHANNEL } from "@/data/regions/english-channel";
import { GULF_OF_FINLAND } from "@/data/regions/gulf-of-finland";
import { NORTH_SEA_SHETLAND } from "@/data/regions/north-sea-shetland";
import { NORWAY_SVALBARD } from "@/data/regions/norway-svalbard";
import { PERTH } from "@/data/regions/perth";
import { TAIWAN_STRAIT } from "@/data/regions/taiwan-strait";

/**
 * Every watched region: the six of ambition-pass 6.4 ranked by free live feed plus incidents, then the two picked by
 * measured coverage (docs/REGIONS.md).
 */
export const REGIONS: readonly Region[] = [
  GULF_OF_FINLAND,
  CENTRAL_BALTIC,
  NORWAY_SVALBARD,
  TAIWAN_STRAIT,
  NORTH_SEA_SHETLAND,
  PERTH,
  ENGLISH_CHANNEL,
  DANISH_STRAITS_KATTEGAT,
];
