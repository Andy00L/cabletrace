import type { CableCase } from "@/lib/cases/case-file";

// The Rubymar cable faults, 24 February 2024. Sources, quotes and the arithmetic behind each placement:
// plan/research/cases/rubymar-2024.md (source ids below keep that file's numbering). Yemen uses Arabia Standard
// Time (UTC+3, "Sanaa time" in CENTCOM's releases); every time here is UTC.
// The link between the ship and the faults is a probable finding: the US National Security Council said "most
// likely" and the cable protection committee "generally accepted". No investigation has published a formal one,
// and the case says so wherever it names the ship as the cause.
// No free AIS archive covers the Red Sea, and the abandoned ship sent none; every position is placed from a
// statement, a satellite image or a slide map and says how in `placement`. Two of them stand on the probable finding
// itself: the ship is placed at the Seacom and EIG faults at their failure times, so the drawn path passes both. The
// AAE-1 fault cannot be on any path (it failed 15 minutes after Seacom's, 7.6 km away), and its cut says so.
// The cut cables' lines are read off the same slides' maps (scripts/seabed/traced-routes.ts): OpenStreetMap maps none
// of them here, and the slides draw all three. Beyond the slide maps the lines are schematic.

const ATTACK_CITATION = {
  sourceId: 1,
  quote:
    "Between 9:30 and 10:45 p.m., Feb. 18, two anti-ship ballistic missiles were launched from Iranian-backed Houthi terrorist-controlled areas of Yemen toward MV Rubymar, a Belize-flagged, UK-owned bulk carrier.",
};
const UKMTO_ATTACK_CITATION = { sourceId: 4, quote: "UKMTO has received a report of an incident 35NM south of Al Mukha, Yemen." };
const AT_ANCHOR_CITATION = { sourceId: 5, quote: "Military authorities report crew have abandoned the vessel. Vessel at anchor and all crew are safe." };
const DRAGGED_CITATION = {
  sourceId: 6,
  quote:
    "The crew took the vessel to anchor and were evacuated by military authorities. The vessel has dragged anchor and now in position 13-21.19N 042-57.64E, and is down by the stern, bows remain above waterline.",
};
const ANCHORED_CITATION = { sourceId: 2, quote: "The ship is anchored but slowly taking on water." };
const ANCHOR_PHOTO_CITATION = { sourceId: 7, quote: "Photographic confirmation that anchor was deployed (fault mechanism)." };
const SATELLITE_POSITION_CITATION = { sourceId: 7, quote: "Lat: 13.282934, Lng: 43.010001" };
const SATELLITE_TIME_CITATION = { sourceId: 8, quote: '"ContentDate":{"Start":"2024-02-24T07:29:09.024000Z","End":"2024-02-24T07:29:09.024000Z"}' };
const OTDR_CITATION = { sourceId: 7, quote: "Direct analysis of OTDR data allowed fault location data to be refined." };
const WHICH_CABLES_CITATION = { sourceId: 7, quote: "AAE-1, SEACOM and EIG confirmed (SEACOM and TGN are the same)." };
const SEACOM_OUTAGE_CITATION = {
  sourceId: 9,
  quote: "In a statement, the company says the disruption is only on the segment of the cable that runs from Mombasa (Kenya) to Zafarana (Egypt).",
};
const SANK_CITATION = {
  sourceId: 3,
  quote:
    "On March 2 at approximately 2:15 a.m. (Sanaa time), Rubymar, a Belize-flagged, UK-owned bulk carrier, sank in the Red Sea after being struck by an Iranian-backed Houthi terrorist anti-ship ballistic missile on Feb. 18.",
};
const NSC_CITATION = {
  sourceId: 12,
  quote: "\"Those cables were cut, most likely by an anchor dragging from the Rubymar as she sank,\" US National Security Council spokesman John Kirby said in an interview on CBS News Wednesday.",
};
const ICPC_CITATION = {
  sourceId: 10,
  quote: "\"It's generally accepted that the Rubymar dropped an anchor when fired upon and as a result it damaged cables in proximity,\" said Ryan Wopschall, general manager of the International Cable Protection Committee, the group representing subsea cable operators.",
};
// How each cut is read off the slides' summary map; the ship marker there is the satellite position above.
const SLIDE_PLACEMENT =
  "Read off the Meta engineers' LINX slide map 'Rubymar summary' (9 km scale bar, north up), in two versions of the map whose readings agree within 80 m, as an offset from the 24 Feb ship marker, which is taken at the satellite position the same slides print (13.282934 N 43.010001 E).";
// Every cut says where its cable's line comes from (scripts/seabed/traced-routes.ts).
const ROUTE_NOTE =
  "The cable's line is traced off the same slides' red route drawings (the summary map and the wider slide 29 map) from 13.38 N to 12.75 N; north and south of that it is schematic: straight legs toward its published landings, kept over water.";
// The two track points placed at a fault stand on the probable finding, and say so.
const AT_FAULT_PLACEMENT =
  "Placed at the fault at the time the slides give for its optical failure, on the probable finding that Rubymar's dragging anchor cut the cable there; no source places the ship at that minute.";

export const RUBYMAR_2024: CableCase = {
  slug: "rubymar-2024",
  title: "Rubymar anchor drag",
  subtitle: "Southern Red Sea, 24 February 2024",
  summary:
    "Hit by a Houthi missile on 18 February, the abandoned bulk carrier Rubymar lay at anchor south of Mokha, then dragged it north through the southern Red Sea's cable corridor. On 24 February the Seacom, AAE-1 and EIG cables failed, after a satellite image that morning showed the ship within 5 km of them. The US National Security Council called its dragging anchor the most likely cause and the cable protection committee called it generally accepted: a probable finding, not a formal one.",
  vessel: {
    name: "Rubymar",
    kind: "bulk-carrier",
    flag: "Belize",
    type: "Bulk carrier, 171.6 m",
    lengthMetres: 171.6,
    imo: "9138898",
    mmsi: null,
    citations: [
      ATTACK_CITATION,
      { sourceId: 15, quote: "The vessel RUBYMAR (IMO 9138898) is a General Cargo Ship built in 1997" },
      { sourceId: 15, quote: "Length Overall (m) 171.60" },
      { sourceId: 10, quote: "The crew abandoned the 172-meter-long ship after dropping one of its anchors, and the vessel drifted for almost two weeks through an area of the Red Sea that's densely populated with cables, before sinking on Saturday." },
    ],
  },
  window: { startUtc: "2024-02-18T18:00:00Z", endUtc: "2024-03-02T12:00:00Z" },
  localTime: { place: "Sanaa", timeZone: "Asia/Aden" },
  seabedArea: "red-sea-south",
  track: [
    {
      atUtc: "2024-02-18T20:00:00Z",
      longitude: 43.25011,
      latitude: 12.73498,
      precision: "area",
      place: "35 nautical miles south of Al Mukha, where the ship was hit",
      placement:
        "35 NM (64.8 km) due south of Mocha town (OpenStreetMap Nominatim node 296878736, 13.31792 N 43.25011 E), UKMTO's distance and bearing; UKMTO's own 2 Mar update calls the same attack 15 NM west of Al Mukha. The point lies 70.7 to 76.6 km from the three faults placed below; the Meta engineers' map draws the attack position 73 to 79 km from them.",
      citations: [UKMTO_ATTACK_CITATION, { sourceId: 4, quote: "18 Feb 2024 2000 UTC" }],
    },
    {
      atUtc: "2024-02-24T07:29:09Z",
      longitude: 43.010001,
      latitude: 13.282934,
      precision: "coordinates",
      place: "A 174 m ship with no AIS on the morning's Sentinel-2 image, identified as Rubymar",
      placement:
        "The coordinates the Meta engineers' LINX slides print beside the ship they measure on the Copernicus Browser image of 24 Feb 2024 and identify as Rubymar. The time is the sensing start of that Sentinel-2 product in the Copernicus catalogue (tile T38PKV); the slides give only the date.",
      citations: [SATELLITE_POSITION_CITATION, SATELLITE_TIME_CITATION, { sourceId: 7, quote: "Close proximity to failed cables (<5km)" }, { sourceId: 7, quote: "Dimensions are consistent" }],
    },
    {
      atUtc: "2024-02-24T09:30:00Z",
      longitude: 43.00571,
      latitude: 13.32476,
      precision: "area",
      place: "At the Seacom fault (placed on the probable finding)",
      placement: `${AT_FAULT_PLACEMENT} The point is the Seacom cut's, read off the slide map. From the satellite position it is 4.67 km in 2.0 hours, about 1.25 knots, against about 0.27 knots averaged from the attack position to the satellite image (66.3 km in 131.5 hours).`,
      citations: [OTDR_CITATION, { sourceId: 7, quote: "09:30UTC Optical" }, NSC_CITATION, ICPC_CITATION],
    },
    {
      atUtc: "2024-02-24T21:00:00Z",
      longitude: 42.9619,
      latitude: 13.33986,
      precision: "area",
      place: "At the EIG fault (placed on the probable finding)",
      placement: `${AT_FAULT_PLACEMENT} The point is the EIG cut's, read off the slide map. From the Seacom fault it is 5.0 km in 11.5 hours, about 0.24 knots.`,
      citations: [OTDR_CITATION, { sourceId: 7, quote: "21:00UTC Optical" }, NSC_CITATION, ICPC_CITATION],
    },
    {
      atUtc: "2024-02-26T12:00:00Z",
      longitude: 42.95811,
      latitude: 13.37522,
      precision: "area",
      place: "North of the faults (slide map, 26 Feb)",
      placement: `${SLIDE_PLACEMENT} The 26 Feb marker sits 10.26 km north and 5.62 km west of it. The slide gives the day only; the point is placed at noon UTC.`,
      citations: [{ sourceId: 7, quote: "Northward drift consistent with known wind and ocean currents since abandonment." }],
    },
    {
      atUtc: "2024-02-28T12:00:00Z",
      longitude: 42.95811,
      latitude: 13.34627,
      precision: "area",
      place: "Back south, beside the EIG fault (slide map, 28 Feb)",
      placement: `${SLIDE_PLACEMENT} The 28 Feb marker sits 7.04 km north and 5.62 km west of it, 0.8 km from the position UKMTO printed on 2 Mar. The slide gives the day only; the point is placed at noon UTC.`,
      citations: [{ sourceId: 7, quote: "Northward drift consistent with known wind and ocean currents since abandonment." }, DRAGGED_CITATION],
    },
    {
      atUtc: "2024-03-02T11:35:00Z",
      longitude: 42.96067,
      latitude: 13.35317,
      precision: "coordinates",
      place: "UKMTO's position after the anchor dragged: down by the stern",
      placement: "UKMTO's printed position 13-21.19N 042-57.64E in decimal degrees; the time is the warning's issue time, about 12 hours after CENTCOM's sinking time.",
      citations: [DRAGGED_CITATION, { sourceId: 6, quote: "Issued: 02 Mar 2024 1135UTC" }],
    },
  ],
  recordedTrack: null,
  dragWindow: {
    startUtc: "2024-02-19T01:57:00Z",
    endUtc: "2024-03-01T23:15:00Z",
    citations: [AT_ANCHOR_CITATION, ANCHORED_CITATION, DRAGGED_CITATION, ANCHOR_PHOTO_CITATION],
  },
  cuts: [
    {
      cableName: "SEACOM",
      label: "Seacom",
      owner: "Seacom",
      atUtc: "2024-02-24T09:30:00Z",
      longitude: 43.00571,
      latitude: 13.32476,
      precision: "area",
      placement: `${SLIDE_PLACEMENT} The 'SEACOM Fault' marker sits 4.65 km north and 0.46 km west of it, at a bend in the cable corridor, 2.4 km from the 'General Fault Locations' point on the slides' chart (13.3241 N 42.9836 E). The time is the '09:30UTC Optical' marker the slides draw at the same bend; Seacom gave only the date. ${ROUTE_NOTE}`,
      citations: [OTDR_CITATION, { sourceId: 7, quote: "09:30UTC Optical" }, WHICH_CABLES_CITATION, SEACOM_OUTAGE_CITATION],
    },
    {
      cableName: "AAE-1",
      label: "AAE-1",
      owner: "AAE-1 consortium",
      atUtc: "2024-02-24T09:45:00Z",
      longitude: 42.94285,
      latitude: 13.35576,
      precision: "area",
      placement: `${SLIDE_PLACEMENT} The 'AAE-1 Fault' marker sits 8.10 km north and 7.27 km west of it. The time is the '09:45TC Optical' marker, the north-west of the slides' two later optical markers, matched to the north-west fault by position; the slides do not name the cable at that marker. No drawn path can pass this fault: it failed 15 minutes after Seacom's, 7.6 km away (about 30 km/h for a ship dragging its anchor), so the replay's path passes 1.65 km from it. ${ROUTE_NOTE}`,
      citations: [OTDR_CITATION, { sourceId: 7, quote: "09:45TC Optical" }, WHICH_CABLES_CITATION],
    },
    {
      cableName: "EIG",
      label: "EIG",
      owner: "EIG consortium",
      atUtc: "2024-02-24T21:00:00Z",
      longitude: 42.9619,
      latitude: 13.33986,
      precision: "area",
      placement: `${SLIDE_PLACEMENT} The 'EIG Fault' marker sits 6.33 km north and 5.21 km west of it, 1.5 km from UKMTO's 2 Mar position. The time is the '21:00UTC Optical' marker, south-east of the 09:45 one, matched to this fault by position; the slides do not name the cable at that marker. ${ROUTE_NOTE}`,
      citations: [OTDR_CITATION, { sourceId: 7, quote: "21:00UTC Optical" }, WHICH_CABLES_CITATION],
    },
  ],
  events: [
    {
      atUtc: "2024-02-18T18:30:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Two Houthi anti-ship ballistic missiles are fired at Rubymar; one hits",
      citations: [ATTACK_CITATION, { sourceId: 1, quote: "One of the missiles struck the vessel, causing damage." }],
    },
    {
      atUtc: "2024-02-18T20:00:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "UKMTO reports an attack 35 nautical miles south of Al Mukha",
      citations: [UKMTO_ATTACK_CITATION, { sourceId: 4, quote: "18 Feb 2024 2000 UTC" }],
    },
    {
      atUtc: "2024-02-19T01:57:00Z",
      isTimeApproximate: false,
      kind: "anchor",
      title: "The crew abandon ship and leave it at anchor",
      citations: [AT_ANCHOR_CITATION, { sourceId: 5, quote: "Issued: 19 Feb 2024 0157 UTC" }, { sourceId: 1, quote: "The crew was transported to a nearby port by the merchant vessel." }],
    },
    {
      atUtc: "2024-02-23T12:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "CENTCOM: the ship is anchored, slowly taking on water, behind an 18-mile oil slick",
      citations: [
        ANCHORED_CITATION,
        { sourceId: 2, quote: "The unprovoked and reckless attack by Iran-backed Houthi terrorists caused significant damage to the ship, which caused an 18-mile oil slick." },
      ],
    },
    {
      atUtc: "2024-02-24T07:29:09Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "Sentinel-2 image: a 174 m ship with no AIS lies within 5 km of the cables that fail later that day",
      citations: [SATELLITE_TIME_CITATION, SATELLITE_POSITION_CITATION, { sourceId: 7, quote: "No AIS transmission" }, { sourceId: 7, quote: "Close proximity to failed cables (<5km)" }],
    },
    {
      atUtc: "2024-02-24T09:30:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "Seacom fails between Mombasa and Zafarana (cause attributed to Rubymar's anchor as probable, not formally found)",
      citations: [{ sourceId: 7, quote: "09:30UTC Optical" }, SEACOM_OUTAGE_CITATION],
    },
    {
      atUtc: "2024-02-24T09:45:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "AAE-1 fails (cause attributed to Rubymar's anchor as probable, not formally found)",
      citations: [{ sourceId: 7, quote: "09:45TC Optical" }, WHICH_CABLES_CITATION],
    },
    {
      atUtc: "2024-02-24T21:00:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "EIG fails (cause attributed to Rubymar's anchor as probable, not formally found)",
      citations: [{ sourceId: 7, quote: "21:00UTC Optical" }, WHICH_CABLES_CITATION],
    },
    {
      atUtc: "2024-03-01T23:15:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Rubymar sinks, 12 days after the attack",
      citations: [SANK_CITATION],
    },
    {
      atUtc: "2024-03-02T11:35:00Z",
      isTimeApproximate: false,
      kind: "anchor",
      title: "UKMTO: the ship has dragged its anchor to 13-21.19N 042-57.64E and lies down by the stern",
      citations: [DRAGGED_CITATION, { sourceId: 6, quote: "Issued: 02 Mar 2024 1135UTC" }],
    },
  ],
  aftermath: [
    {
      atUtc: "2024-03-06T23:34:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "The US National Security Council calls Rubymar's dragging anchor the most likely cause; the cable protection committee calls it generally accepted (a probable finding, not a formal one)",
      citations: [
        NSC_CITATION,
        {
          sourceId: 11,
          quote: "\"Those cables were cut mostly by an anchor dragging from the Rubymar as she sank,\" White House national security communications adviser John Kirby told CBS News national security correspondent David Martin in an interview Wednesday.",
        },
        ICPC_CITATION,
        { sourceId: 10, quote: "But a dragged anchor seemed likely, he said." },
      ],
    },
    {
      atUtc: "2024-03-08T10:20:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "Seacom awaits permits to repair in Yemeni waters",
      citations: [
        { sourceId: 13, quote: "Seacom on Friday said it is still awaiting the necessary permits to fix its broken cable system in the Red Sea." },
        { sourceId: 13, quote: "\"As part of the regulatory process, we anticipate that permitting could take up to eight weeks to obtain,\" it said." },
      ],
    },
    {
      atUtc: "2024-07-17T20:49:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "AAE-1 repaired and back online; the same ship stays to repair Seacom and EIG",
      citations: [
        {
          sourceId: 14,
          quote:
            "The AAE-1 cable, a 25,000-kilometer (15,500 miles) fiber optic link between Asia and Europe, was repaired by a ship owned by E-Marine, a subsidiary of Abu Dhabi-based Emirates Telecommunications Group. The cable came online this week, a Yemeni government official said.",
        },
        { sourceId: 14, quote: "The same ship, Niwa, remains in Yemeni waters to repair the remaining two cables, Seacom and EIG." },
      ],
    },
    {
      atUtc: "2024-11-21T14:35:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Meta's cable engineers publish their analysis: OTDR fault positions, a satellite sighting and a photo of the deployed anchor",
      citations: [OTDR_CITATION, ANCHOR_PHOTO_CITATION, { sourceId: 7, quote: "Close proximity to failed cables (<5km)" }],
    },
  ],
  // centcom.mil turns the Wayback Machine away (three save requests answered 520 on 17 Oct 2026, and no capture
  // exists), so sources 1 to 3 have no archived copy; their text was read in a browser on 17 Oct 2026.
  sources: [
    {
      id: 1,
      publisher: "U.S. Central Command",
      title: "Feb. 18 Summary of Red Sea Activities (Release Number 20240219 - 01)",
      url: "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/3680410/feb-18-summary-of-red-sea-activities/",
      publishedOn: "2024-02-19",
      archivedUrl: null,
    },
    {
      id: 2,
      publisher: "U.S. Central Command",
      title: "Update to Feb. 18 Houthi attack on commercial shipping (Release Number 20240223 - 02)",
      url: "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/3686117/update-to-feb-18-houthi-attack-on-commercial-shipping/",
      publishedOn: "2024-02-23",
      archivedUrl: null,
    },
    {
      id: 3,
      publisher: "U.S. Central Command",
      title: "Sinking of Motor Vessel Rubymar Risks Environmental Damage (Press Release Number 20240302-02)",
      url: "https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/3693370/sinking-of-motor-vessel-rubymar-risks-environmental-damage/",
      publishedOn: "2024-03-02",
      archivedUrl: null,
    },
    {
      id: 4,
      publisher: "UK Maritime Trade Operations (UKMTO)",
      title: "UKMTO Warning Incident 032 - Attack",
      url: "https://www.ukmto.org/-/media/ukmto/warnings/indian-ocean/2024/feb/20240218-ukmto-warning-incident-032.pdf",
      publishedOn: "2024-02-18",
      archivedUrl: "https://web.archive.org/web/20240305162009/https://www.ukmto.org/-/media/ukmto/warnings/indian-ocean/2024/feb/20240218-ukmto-warning-incident-032.pdf",
    },
    {
      id: 5,
      publisher: "UK Maritime Trade Operations (UKMTO)",
      title: "UKMTO Warning Incident 032 - Attack Update 003",
      url: "https://www.ukmto.org/-/media/ukmto/warnings/indian-ocean/2024/feb/20240219-ukmto-warning-032-update-003.pdf",
      publishedOn: "2024-02-19",
      archivedUrl: "https://web.archive.org/web/20240219080840/https://www.ukmto.org/-/media/ukmto/warnings/indian-ocean/2024/feb/20240219-ukmto-warning-032-update-003.pdf",
    },
    {
      id: 6,
      publisher: "UK Maritime Trade Operations (UKMTO)",
      title: "UKMTO Warning Incident 032 - Attack Update 004",
      url: "https://www.ukmto.org/-/media/ukmto/warnings/indian-ocean/2024/mar/20240302-ukmto-warning-incident-032-update-004.pdf",
      publishedOn: "2024-03-02",
      archivedUrl: "https://web.archive.org/web/20240325080352/https://www.ukmto.org/-/media/ukmto/warnings/indian-ocean/2024/mar/20240302-ukmto-warning-incident-032-update-004.pdf",
    },
    {
      id: 7,
      publisher: "Nick Harrington and Michael Cuddington (Meta), LINX",
      title: "Misinformation in the Red Sea: Investigating Concurrent Failures (slides)",
      url: "https://www.linx.net/wp-content/uploads/2024/11/Misinformation-in-the-Red-Sea-1.pdf",
      publishedOn: "2024-11-21",
      archivedUrl: "https://web.archive.org/web/20261017164505/https://www.linx.net/wp-content/uploads/2024/11/Misinformation-in-the-Red-Sea-1.pdf",
    },
    {
      id: 8,
      publisher: "Copernicus Data Space Ecosystem catalogue",
      title: "S2B_MSIL2A_20240224T072909_N0510_R049_T38PKV_20240224T094914 (Sentinel-2 product record)",
      url: "https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=Name%20eq%20'S2B_MSIL2A_20240224T072909_N0510_R049_T38PKV_20240224T094914.SAFE'",
      publishedOn: "2024-02-24",
      archivedUrl: "https://web.archive.org/web/20261017170352/https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=Name%20eq%20%27S2B_MSIL2A_20240224T072909_N0510_R049_T38PKV_20240224T094914.SAFE%27",
    },
    {
      id: 9,
      publisher: "SubTel Forum (Seacom statement)",
      title: "Seacom Confirms Cable Outage in Red Sea",
      url: "https://subtelforum.com/seacom-confirms-cable-outage-in-red-sea/",
      publishedOn: "2024-02-26",
      archivedUrl: "https://web.archive.org/web/20260923051139/https://subtelforum.com/seacom-confirms-cable-outage-in-red-sea/",
    },
    {
      id: 10,
      publisher: "gCaptain (Bloomberg)",
      title: "'Rubymar' Anchor Seen as Likely Cause of Severed Red Sea Cables",
      url: "https://gcaptain.com/rubymar-anchor-seen-as-likely-cause-of-severed-red-sea-cables/",
      publishedOn: "2024-03-06",
      archivedUrl: "https://web.archive.org/web/20261017164823/https://gcaptain.com/rubymar-anchor-seen-as-likely-cause-of-severed-red-sea-cables/",
    },
    {
      id: 11,
      publisher: "CBS News",
      title: "Ship sunk by Houthis likely responsible for damaging 3 telecommunications cables under Red Sea",
      url: "https://www.cbsnews.com/news/houthis-ship-cutting-red-sea-telecommunications-cables/",
      publishedOn: "2024-03-06",
      archivedUrl: "https://web.archive.org/web/20261017164548/https://www.cbsnews.com/news/houthis-ship-cutting-red-sea-telecommunications-cables/",
    },
    {
      id: 12,
      publisher: "Insurance Journal (Bloomberg)",
      title: "Houthi-Sunk Ship Seen as Likely Cause of Severed Red Sea Cables",
      url: "https://www.insurancejournal.com/news/international/2024/03/07/763869.htm",
      publishedOn: "2024-03-07",
      archivedUrl: "https://web.archive.org/web/20251210234432/https://www.insurancejournal.com/news/international/2024/03/07/763869.htm",
    },
    {
      id: 13,
      publisher: "TechCentral",
      title: "Seacom still needs repair permits for Red Sea cable break",
      url: "https://techcentral.co.za/seacom-repair-permits-red-sea-cable-break/241055/",
      publishedOn: "2024-03-08",
      archivedUrl: "https://web.archive.org/web/20260612233719/https://techcentral.co.za/seacom-repair-permits-red-sea-cable-break/241055/",
    },
    {
      id: 14,
      publisher: "gCaptain (Bloomberg)",
      title: "Damaged Subsea Cables Repaired in Red Sea",
      url: "https://gcaptain.com/damaged-subsea-cables-repaired-in-red-sea/",
      publishedOn: "2024-07-17",
      archivedUrl: "https://web.archive.org/web/20261017165015/https://gcaptain.com/damaged-subsea-cables-repaired-in-red-sea/",
    },
    { id: 15, publisher: "VesselFinder", title: "RUBYMAR, General Cargo Ship, IMO 9138898", url: "https://www.vesselfinder.com/vessels/details/9138898", publishedOn: "2026-10-17", archivedUrl: "https://web.archive.org/web/20261017165100/https://www.vesselfinder.com/vessels/details/9138898" },
  ],
};
