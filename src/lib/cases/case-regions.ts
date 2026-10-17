// The region each case belongs to, by the seabed area its replay draws, for the case list's groups. Listed in the
// order the list shows them: the watched Baltic first, then the other seas with cases. A case on an area not listed
// here falls into "Other waters", so a new area never hides a case.

export type CaseRegion = { id: string; name: string };

const REGIONS_BY_SEABED_AREA: readonly { region: CaseRegion; seabedAreas: readonly string[] }[] = [
  { region: { id: "gulf-of-finland", name: "Gulf of Finland" }, seabedAreas: ["gulf-of-finland", "gulf-of-finland-and-hiiumaa"] },
  { region: { id: "central-baltic", name: "Central Baltic" }, seabedAreas: ["baltic-proper", "gotland-latvia"] },
  { region: { id: "norway-svalbard", name: "Norway and Svalbard" }, seabedAreas: ["svalbard"] },
  { region: { id: "taiwan-strait", name: "Taiwan Strait" }, seabedAreas: ["taiwan-penghu", "taiwan-keelung", "matsu"] },
  { region: { id: "red-sea", name: "Red Sea" }, seabedAreas: ["red-sea-south"] },
];
const OTHER_WATERS: CaseRegion = { id: "other", name: "Other waters" };

export function findCaseRegion(seabedArea: string): CaseRegion {
  return REGIONS_BY_SEABED_AREA.find((entry) => entry.seabedAreas.includes(seabedArea))?.region ?? OTHER_WATERS;
}

/** Groups items by region in the list's region order, keeping each group's items in their given order; empty regions are left out. */
export function groupByCaseRegion<Item>(items: readonly Item[], readSeabedArea: (item: Item) => string): { region: CaseRegion; items: Item[] }[] {
  const order = [...REGIONS_BY_SEABED_AREA.map((entry) => entry.region), OTHER_WATERS];
  return order
    .map((region) => ({ region, items: items.filter((item) => findCaseRegion(readSeabedArea(item)).id === region.id) }))
    .filter((group) => group.items.length > 0);
}
