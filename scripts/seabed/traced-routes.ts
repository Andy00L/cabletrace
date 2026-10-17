// Cable routes no open dataset maps, for scripts/seabed/build-seabed.ts. Each says where its points come from in
// `source`, and that text joins the area's cable credit. Two kinds exist:
//   traced: the line of a published map, georeferenced (good to the map's scale);
//   placed: straight legs through points the authorities published in words (a landing, a break, a distance),
//           because no route map is published; good near the published points only, schematic between them.
// Points are [longitude, latitude]. The arithmetic behind the placed points is in plan/research/cases/<case>.md.

export type Coordinate = [number, number];

export type TracedLine = { name: string; kind: "power" | "telecom"; source: string; points: Coordinate[] };

// EE-S1 (Arelion, Stavsnäs to Kärdla to Tallinn) is not in OpenStreetMap or any EMODnet cable layer. Its route
// is read off Yle's map of 20 Oct 2023 (https://yle.fi/a/74-20056160): the red line's centre, every 12 to 24
// pixels, in the Web Mercator frame fitted to the map's three landing dots (Stavsnäs, Kärdla, Tallinn on
// Nominatim; residuals 0.5 to 1.3 km). The map draws about 0.73 km per pixel, so the route is good to a few km.
export const EE_S1_TRACED: TracedLine = {
  name: "EE-S1",
  kind: "telecom",
  source: "EE-S1 route read off a Yle map (yle.fi/a/74-20056160)",
  points: [
    [19.9498, 59.2639],
    [20.3444, 59.2605],
    [20.5811, 59.2437],
    [20.8179, 59.2134],
    [21.0546, 59.1966],
    [21.3703, 59.1595],
    [21.6859, 59.1427],
    [22.0016, 59.1055],
    [22.3173, 59.0549],
    [22.554, 59.021],
    [22.725, 58.9987],
    [22.8697, 59.0481],
    [23.0275, 59.1271],
    [23.1854, 59.2121],
    [23.3432, 59.274],
    [23.501, 59.321],
    [23.6589, 59.38],
    [23.8167, 59.4282],
    [23.9745, 59.4683],
    [24.1324, 59.4816],
    [24.2902, 59.4983],
    [24.448, 59.4917],
    [24.6059, 59.4616],
    [24.7729, 59.4329],
  ],
};

// Taiwan-Penghu No. 3 (Chunghwa Telecom) is not in OpenStreetMap, and no route map is published (the Navy's
// notices to mariners on its site start in 2017, after the cable was laid). Placed from these statements:
//   the Ministry of Digital Affairs puts the 25 Feb 2025 break "臺南北門14.7公里處" (14.7 km off Beimen, Tainan);
//   the Coast Guard puts the ship 6 nmi north-west of Jiangjun fishing harbour, 0.5 nmi north of the cable;
//   the Penghu end is drawn at the county seat, Magong, because the Penghu landing is not published.
// Legs: Beimen district (Nominatim relation 2417980), the break (0.5 nmi south of the point 6 nmi at 315 degrees
// from Jiangjun fishing harbour, Nominatim node 1798499222), Magong (Nominatim relation 3339737). Beimen to the
// break is 11.8 km in a straight line against 14.7 km of cable, so the shore leg bends somewhere unknown.
export const TP3_PLACED: TracedLine = {
  name: "Taiwan-Penghu No. 3 (TP3)",
  kind: "telecom",
  source: "TP3 placed from Ministry of Digital Affairs and Coast Guard statements (no route map published)",
  points: [
    [120.12572, 23.26792],
    [120.01038, 23.27403],
    [119.57849, 23.56638],
  ],
};

// Taiwan-Matsu No. 2 (TDM2, Chunghwa Telecom, Tamsui to Dongyin) is not in OpenStreetMap. Placed from the
// Lienchiang District Court judgment of 4 Dec 2025 (114 訴 20): the 7 Oct 2025 break at 26.39910 N 120.57971 E,
// "東引機房北方外海約4.2浬" and 180.6 km of cable from the Shalun station in Tamsui. Legs: the Dongyin Chunghwa
// Telecom office (Nominatim way 431591218), the break, then straight toward Shalun (Nominatim node 3469003626) to
// where that line leaves the matsu block (73.4 km from the break). The straight break-to-Shalun line is 159.1 km
// against 180.6 km of cable, so the route south of the break is schematic.
export const TDM2_PLACED: TracedLine = {
  name: "Taiwan-Matsu No. 2 (TDM2)",
  kind: "telecom",
  source: "TDM2 placed from a Lienchiang District Court judgment (no route map published)",
  points: [
    [120.48791, 26.36686],
    [120.57971, 26.3991],
    [120.97016, 25.83979],
  ],
};

// The Beigan to Dongyin segment of Taiwan-Matsu No. 3 (Chunghwa Telecom) is not in OpenStreetMap. Placed from
// the Coast Guard (the segment "北竿至東引段" was damaged on 30 Mar 2026) and the Lienchiang prosecutors as CNA
// reported them (the cable lay under a wreck stranded at the Beiao shore of Dongyin). Legs: the Beiao shore (Beiao
// bay, Nominatim way 904466212, moved 240 m north to 26.374 N, the first water vertex of the matsu block) and Baisha
// harbour on Beigan (Nominatim node 2342030449); neither landing is published, so the 55 km between them is
// schematic.
export const TM3_DONGYIN_PLACED: TracedLine = {
  name: "Taiwan-Matsu No. 3 (TM3)",
  kind: "telecom",
  source: "TM3 Beigan to Dongyin placed from Coast Guard and prosecutor statements (no route map published)",
  points: [
    [120.49129, 26.374],
    [119.96851, 26.20516],
  ],
};
