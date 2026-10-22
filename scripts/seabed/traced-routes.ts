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

// SEACOM, AAE-1 and EIG through the southern Red Sea, the three cables that failed on 24 Feb 2024 (the Rubymar case,
// src/data/cases/rubymar-2024.ts), are not in OpenStreetMap, which maps only FLAG Europe-Asia there. Their routes are
// read off the maps in the Meta engineers' LINX slides "Misinformation in the Red Sea" (Nov 2024, the case's source 7,
// archived at web.archive.org/web/20261017164505/https://www.linx.net/wp-content/uploads/2024/11/Misinformation-in-the-Red-Sea-1.pdf),
// which draw the three routes in red and label them "SEACOM seg 15 (approx) (2009)", "AAE-1 seg S-15.19 (2016)" and
// "EIG seg 4.5 (2010)". The slides carry no licence; like EE-S1 above, the line is read off a published map and
// credited. Each red line's centre was followed every 4 px (3 px on slide 29) and kept within 50 m:
//   13.38 to 13.21 N, traced: the "Rubymar summary" map (9 km scale bar, 64.1 px per km in the embedded image, north
//     up), in the frame the case's faults were read in: origin at the 24 Feb ship marker, taken at the satellite
//     position the slides print (13.282934 N 43.010001 E). The map's second version agrees within 21 m for 95 per
//     cent of the samples.
//   13.21 to 12.75 N, traced: the slide 29 map (40 km scale bar, 15.0 px per km), placed so its three fault stars sit
//     on the summary map's faults (32 to 51 m off). Where both maps draw a line they agree within 50 m. The trace stops
//     where the slide draws the lines crossing beside the 18 Feb attack marker.
//   Each fault is a vertex of its line; the traced centre passed 11 to 22 m from it.
//   Schematic beyond the slide maps, straight legs kept over water on the red-sea-south land mask. North: to a point
//     west of the islands at 13.65 to 13.78 N (a straight leg toward the landing crosses them), then straight toward
//     the next published landing to the block edge: Zafarana (lighthouse, Nominatim node 768563398) for SEACOM, whose
//     cut segment runs Mombasa to Zafarana (the case's source 9), and Jeddah (Nominatim node 1933393717) for AAE-1 and
//     EIG. South: through the strait west of Perim to the block's south edge, clear of the African shore, toward
//     Djibouti. The landings are the ones Djibouti Telecom, an owner or landing party of all three, lists on
//     international.djiboutitelecom.dj (/seacom/, /aae1/ and /eig-europe-india-gateway/, read 22 Oct 2026).
const RED_SEA_CUT_CABLES_SOURCE = "SEACOM, AAE-1 and EIG read off the Meta engineers' LINX slide maps (Nov 2024), schematic beyond them";

export const SEACOM_RED_SEA_TRACED: TracedLine = {
  name: "SEACOM",
  kind: "telecom",
  source: RED_SEA_CUT_CABLES_SOURCE,
  points: [
    [42.28, 14.20706],
    [42.62, 13.68],
    [42.91366, 13.38394],
    [42.95725, 13.33085],
    [42.96554, 13.32468],
    [42.9816, 13.31832],
    [43.00571, 13.32476],
    [43.00736, 13.32531],
    [43.00859, 13.32503],
    [43.02905, 13.31717],
    [43.04624, 13.30294],
    [43.06054, 13.28386],
    [43.08048, 13.25024],
    [43.0992, 13.22592],
    [43.10547, 13.21516],
    [43.10668, 13.21341],
    [43.11163, 13.20369],
    [43.11421, 13.20096],
    [43.11546, 13.19746],
    [43.11865, 13.19296],
    [43.13092, 13.17075],
    [43.13324, 13.16789],
    [43.15267, 13.13309],
    [43.1552, 13.13032],
    [43.15817, 13.12365],
    [43.2087, 13.03761],
    [43.21001, 13.03417],
    [43.23053, 12.99994],
    [43.24688, 12.97174],
    [43.24735, 12.96991],
    [43.25509, 12.95762],
    [43.26093, 12.94637],
    [43.26594, 12.9388],
    [43.27766, 12.91837],
    [43.2822, 12.90849],
    [43.30467, 12.8456],
    [43.30704, 12.83319],
    [43.3084, 12.82426],
    [43.30705, 12.80265],
    [43.30668, 12.77924],
    [43.30705, 12.76844],
    [43.30816, 12.76129],
    [43.30762, 12.75942],
    [43.30811, 12.75763],
    [43.30776, 12.74685],
    [43.365, 12.548],
    [43.41, 12.38],
  ],
};

export const AAE1_RED_SEA_TRACED: TracedLine = {
  name: "AAE-1",
  kind: "telecom",
  source: RED_SEA_CUT_CABLES_SOURCE,
  points: [
    [42.39081, 14.22],
    [42.626, 13.684],
    [42.92003, 13.38385],
    [42.94285, 13.35576],
    [42.96114, 13.33381],
    [42.96817, 13.32883],
    [42.97449, 13.32603],
    [42.98189, 13.32468],
    [43.00509, 13.32951],
    [43.01144, 13.32885],
    [43.02647, 13.32295],
    [43.03408, 13.31893],
    [43.05145, 13.30587],
    [43.05587, 13.3014],
    [43.06447, 13.2901],
    [43.08275, 13.26014],
    [43.08532, 13.25789],
    [43.09007, 13.25574],
    [43.10647, 13.25252],
    [43.10906, 13.25118],
    [43.11184, 13.24825],
    [43.11957, 13.23193],
    [43.12941, 13.21539],
    [43.13035, 13.21368],
    [43.15758, 13.16872],
    [43.16452, 13.15396],
    [43.19385, 13.10398],
    [43.21863, 13.06393],
    [43.22087, 13.05897],
    [43.24118, 13.02467],
    [43.24349, 13.02182],
    [43.24584, 13.01689],
    [43.26816, 12.97961],
    [43.26863, 12.97777],
    [43.27116, 12.97501],
    [43.27162, 12.97317],
    [43.27896, 12.96069],
    [43.30066, 12.92509],
    [43.31451, 12.88402],
    [43.31723, 12.87346],
    [43.32275, 12.85817],
    [43.32544, 12.84768],
    [43.32656, 12.84607],
    [43.32712, 12.84247],
    [43.32737, 12.81906],
    [43.32874, 12.79931],
    [43.32841, 12.77055],
    [43.3293, 12.76874],
    [43.32856, 12.75423],
    [43.32735, 12.7471],
    [43.37, 12.552],
    [43.415, 12.38],
  ],
};

export const EIG_RED_SEA_TRACED: TracedLine = {
  name: "EIG",
  kind: "telecom",
  source: RED_SEA_CUT_CABLES_SOURCE,
  points: [
    [42.39804, 14.22],
    [42.632, 13.688],
    [42.92577, 13.38394],
    [42.9619, 13.33986],
    [42.96309, 13.33819],
    [42.9689, 13.3343],
    [42.97678, 13.33079],
    [42.98188, 13.32974],
    [43.00231, 13.33387],
    [43.0133, 13.33306],
    [43.02432, 13.32968],
    [43.03438, 13.3254],
    [43.05421, 13.3108],
    [43.07292, 13.28791],
    [43.08137, 13.27066],
    [43.08505, 13.26562],
    [43.09121, 13.26148],
    [43.10563, 13.25981],
    [43.10963, 13.2575],
    [43.11337, 13.25398],
    [43.1357, 13.21525],
    [43.13614, 13.21454],
    [43.20341, 13.10071],
    [43.20469, 13.09726],
    [43.21074, 13.08817],
    [43.26722, 12.99117],
    [43.2878, 12.95708],
    [43.28824, 12.95523],
    [43.30402, 12.92878],
    [43.30438, 12.92492],
    [43.30644, 12.92353],
    [43.30946, 12.91698],
    [43.31475, 12.88182],
    [43.31858, 12.87975],
    [43.32219, 12.87145],
    [43.32563, 12.86696],
    [43.33168, 12.848],
    [43.33349, 12.81019],
    [43.33389, 12.77407],
    [43.33225, 12.77026],
    [43.33325, 12.76487],
    [43.33291, 12.75049],
    [43.375, 12.556],
    [43.42, 12.38],
  ],
};
