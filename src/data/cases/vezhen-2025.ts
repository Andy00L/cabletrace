import type { CableCase } from "@/lib/cases/case-file";
import { VEZHEN_AIS_FIXES } from "@/data/cases/vezhen-2025-ais";

// The Vezhen anchor drag, 26 January 2025. Sources, quotes, conflicts and the arithmetic behind each placement:
// plan/research/cases/vezhen-2025.md (source ids below keep that file's numbering). Every time here is UTC;
// Sweden used CET (UTC+1) in January and CEST (UTC+2) in October, Latvia EET (UTC+2).
// Sweden's prosecutors found the damage was an accident and closed their case; the case says so and keeps
// what was suspected at the time apart from what was found.
// The ship's own AIS survives only from 17:05:43 UTC on 26 January (the Danish archive). Earlier positions are
// placed from written descriptions and say how in `placement`.

const PASSAGE_CITATION = {
  sourceId: 15,
  quote: "The Vezhen, which Bulgarian shipping company Navigation Maritime Bulgare listed among its fleet, passed the fibre optic cable at 00:45 GMT on Sunday.",
};
const PASSAGE_LOCAL_CITATION = { sourceId: 13, quote: "On January 26, at around 1 a.m., the ship crossed the cable linking Latvia to the island of Gotland." };
const DISTANCE_CITATION = { sourceId: 8, quote: "The location of the cable damage is 130km from the LVRTC facilities in Ventspils. The cable damage is 100m underwater." };
const DAMAGED_CITATION = {
  sourceId: 6,
  quote:
    "Early on January 26th, the submarine optical fiber cable in the Baltic Sea belonging to SJSC Latvia State Radio and Television Center (hereinafter - LVRTC) was damaged. LVRTC's Data Transmission Monitoring System detected disruptions in data transmission services on the Ventspils-Gotland (Fårösund) segment.",
};
const NIGHT_CITATION = {
  sourceId: 2,
  quote: "Det var natten till söndag den 26 januari som skadan upptäcktes på en kommunikationskabel mellan Sverige och Lettland i Östersjön.",
  translation: "It was in the night to Sunday 26 January that the damage was discovered on a communication cable between Sweden and Latvia in the Baltic Sea.",
};
const ROUTE_CITATION = {
  sourceId: 17,
  quote: "Vezhen var på väg från den ryska hamnen Ust-Luga till Skagen i Danmark, enligt marinetraffic.com.",
  translation: "Vezhen was on its way from the Russian port of Ust-Luga to Skagen in Denmark, according to marinetraffic.com.",
};
const FIRST_FIX_CITATION = {
  sourceId: 18,
  quote: "26/01/2025 17:05:43,Class A,229659000,55.866182,15.837187,Under way using engine,0.0,6.0,276.2,280",
};
const LOCK_CITATION = {
  sourceId: 4,
  quote:
    "Utredningen visar att den enda fungerande anordningen för att hålla ankaret på plats, det så kallade Björnlåset, går sönder efter en kraftig våg den 25 januari kl. 04.11. Till följd av detta löser ankar och kätting ut med hela sin längd.",
  translation:
    "The investigation shows that the only working device for holding the anchor in place, the so-called Bear Lock, breaks after a heavy wave on 25 January at 04.11. As a result, the anchor and chain run out to their full length.",
};
const REACHED_CABLE_CITATION = {
  sourceId: 4,
  quote: "Fartyget har dagen efter nått kabeln utanför Gotland på svensk ekonomisk zon och ankaret har då skadat kommunikationskabeln.",
  translation: "The day after, the ship reached the cable off Gotland in the Swedish economic zone, and the anchor then damaged the communication cable.",
};
const RAISED_ANCHOR_CITATION = {
  sourceId: 17,
  quote: "Fartyget stannade, tog upp ankaret och fortsatte resan.",
  translation: "The ship stopped, took up the anchor and continued the voyage.",
};
const SLOWED_CITATION = {
  sourceId: 16,
  quote: "The ship passed near the area where the cable damage was later discovered without changing speed, but reduced its speed to almost zero three hours later.",
};
const ESCORT_CITATION = { sourceId: 15, quote: "MarineTraffic data showed that a coastguard vessel escorted the bulk carrier Vezhen to Swedish waters on Sunday where it later anchored." };

export const VEZHEN_2025: CableCase = {
  slug: "vezhen-2025",
  title: "Vezhen anchor drag",
  subtitle: "East of Gotland, 26 January 2025",
  summary:
    "The bulk carrier Vezhen passed over LVRTC's Ventspils-Gotland cable at 00:45 UTC on 26 January, and the cable failed that night. Sweden's prosecutors found that a wave had broken the last working anchor lock the day before, so the anchor dragged unnoticed, and closed the case in October 2025 as an accident. The ship's own AIS survives only from 17:05 that day, off Karlskrona; the earlier track is placed from statements.",
  vessel: {
    name: "Vezhen",
    kind: "bulk-carrier",
    flag: "Malta",
    type: "Bulk carrier, 190 m",
    imo: "9937270",
    mmsi: "229659000",
    citations: [
      {
        sourceId: 14,
        quote: "The Bulgarian shipping company Navigation Maritime Bulgares, which owns the Maltese-flagged dry cargo vessel Vezhen, denied deliberately damaging the undersea fiber-optic cable linking Latvia and Sweden.",
      },
      { sourceId: 18, quote: "26/01/2025 17:28:43,Class A,229659000,55.880052,15.763425,Under way using engine,0.0,9.4,308.6,307,9937270,9HA5550,VEZHEN,Cargo,,24,190" },
      ESCORT_CITATION,
      ROUTE_CITATION,
    ],
  },
  window: { startUtc: "2025-01-26T00:30:00Z", endUtc: "2025-01-26T20:00:00Z" },
  localTime: { place: "Stockholm", timeZone: "Europe/Stockholm" },
  seabedArea: "gotland-latvia",
  track: [
    {
      atUtc: "2025-01-26T00:45:00Z",
      longitude: 19.54927,
      latitude: 57.75006,
      precision: "area",
      place: "Over the Ventspils-Gotland cable, 130 km from Ventspils",
      placement:
        "No source prints a coordinate. The point 130 km along the mapped Sweden-Latvia route (OpenStreetMap, operator LVRTC) from its Ventspils end, the distance LVRTC gives from its Ventspils facilities; it lies 32 km along the route from the Gotland end near Fårösund, and the depth grid there reads 91 m against LVRTC's 100 m. The time is the 00:45 GMT passage Reuters read from MarineTraffic.",
      citations: [DISTANCE_CITATION, PASSAGE_CITATION, PASSAGE_LOCAL_CITATION, REACHED_CABLE_CITATION],
    },
    {
      atUtc: "2025-01-26T07:05:00Z",
      longitude: 18.39772,
      latitude: 56.84978,
      precision: "area",
      place: "South-east of Gotland's southern tip (route not published)",
      placement:
        "No source gives the route between the cable and Karlskrona. Bound for Skagen, the ship had to round Gotland, so the line passes 15 km east and 8 km south of Hoburg lighthouse (OpenStreetMap, 56.92173 N, 18.15104 E), which keeps both legs at least 8 km off land on the depth grid. The time assumes one average speed from the cable to the first AIS fix, 313.6 km in 16 h 21 min (10.4 knots), and ignores the stop the owner describes.",
      citations: [ROUTE_CITATION, PASSAGE_CITATION, FIRST_FIX_CITATION],
    },
  ],
  recordedTrack: {
    selection:
      "Rows with MMSI 229659000 in the Danish Maritime Authority file for 26 January, 00:30 to 20:00, the first of every 2 minutes and the last row. The file holds no Vezhen rows before 17:05:43 and none on 25 January. The archive does not state a time zone; the rows are read as UTC, as in the Yi Peng 3 case.",
    citations: [FIRST_FIX_CITATION],
    fixes: VEZHEN_AIS_FIXES,
  },
  dragWindow: {
    startUtc: "2025-01-26T00:30:00Z",
    endUtc: "2025-01-26T03:45:00Z",
    citations: [LOCK_CITATION, REACHED_CABLE_CITATION, SLOWED_CITATION, RAISED_ANCHOR_CITATION],
  },
  cuts: [
    {
      cableName: "Sweden-Latvia",
      label: "Ventspils-Gotland",
      owner: "LVRTC",
      atUtc: "2025-01-26T00:45:00Z",
      longitude: 19.54927,
      latitude: 57.75006,
      precision: "area",
      placement:
        "The point 130 km along the mapped Sweden-Latvia route (OpenStreetMap) from its Ventspils end, the distance LVRTC gives; no source gives a fault time, so the cut takes the time the ship passed.",
      citations: [
        DISTANCE_CITATION,
        DAMAGED_CITATION,
        NIGHT_CITATION,
        {
          sourceId: 11,
          quote:
            "The Transport Accident and Incident Investigation Bureau has launched a preliminary assessment regarding a maritime incident that occurred on January 26, 2025, involving damage to the Ventspils - Gotland optical cable in the Exclusive Economic Zone of the Kingdom of Sweden.",
        },
      ],
    },
  ],
  events: [
    {
      atUtc: "2025-01-26T00:45:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Vezhen passes over the Ventspils-Gotland cable",
      citations: [PASSAGE_CITATION, PASSAGE_LOCAL_CITATION],
    },
    {
      atUtc: "2025-01-26T00:45:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "The Ventspils-Gotland link fails on LVRTC's monitoring",
      citations: [DAMAGED_CITATION, NIGHT_CITATION],
    },
    {
      atUtc: "2025-01-26T03:45:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "Speed falls almost to zero; the owner says the crew stopped and raised the anchor",
      citations: [
        SLOWED_CITATION,
        {
          sourceId: 17,
          quote: "Det var först på söndagsmorgonen de kunde ge sig ut.",
          translation: "Only on Sunday morning could they go out on deck.",
        },
        RAISED_ANCHOR_CITATION,
      ],
    },
    {
      atUtc: "2025-01-26T13:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "LVRTC reports the cable damaged by external factors and starts criminal proceedings",
      citations: [
        {
          sourceId: 6,
          quote: "Based on current findings, it is presumed that the cable is significantly damaged due to external factors. LVRTC has initiated criminal procedural actions.",
        },
      ],
    },
    {
      atUtc: "2025-01-26T15:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "A Latvian Navy patrol vessel inspects Michalis San and sees nothing suspicious",
      citations: [
        {
          sourceId: 9,
          quote:
            "Today, on January 26, the Naval Forces of the National Armed Forces received information from the Latvian State Radio and Television Centre regarding damage to the Ventspils-Gotland optical cable identified in Sweden's exclusive economic zone. The Naval Forces immediately dispatched a patrol vessel to inspect a potentially involved ship.",
        },
        { sourceId: 12, quote: "The vessel was found to be en route to Russia. No suspicious activity on board or damage to the anchor was observed by the Navy." },
      ],
    },
    {
      atUtc: "2025-01-26T17:05:43Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "First position in the Danish AIS archive: 6 knots, heading west, 51 km south-west of Öland's southern cape",
      citations: [FIRST_FIX_CITATION],
    },
    {
      atUtc: "2025-01-26T17:20:37Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Turns north-west for Karlskrona and speeds up to 11 knots",
      citations: [
        { sourceId: 18, quote: "26/01/2025 17:20:37,Class A,229659000,55.869047,15.790353,Under way using engine,,7.6,294.8,301" },
        { sourceId: 18, quote: "26/01/2025 18:11:53,Class A,229659000,55.951182,15.570948,Under way using engine,0.0,11.2,299.1,297" },
        ESCORT_CITATION,
      ],
    },
    {
      atUtc: "2025-01-26T18:39:12Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Last position of the day in the archive: 5.3 knots, 13 km south of Aspö",
      citations: [{ sourceId: 18, quote: "26/01/2025 18:39:12,Class A,229659000,56.000442,15.515122,Under way using engine,0.0,5.3,339.0,346" }],
    },
    {
      atUtc: "2025-01-26T19:56:00Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "Prosecutors announce a gross sabotage investigation and the seizure of a ship",
      citations: [
        {
          sourceId: 1,
          quote:
            "En förundersökning om misstänkt grovt sabotage har inletts med anledning av en misstänkt skada på en kommunikationskabel som går mellan Sverige och Lettland i Östersjön. Ett fartyg som misstänks ha genomfört sabotaget har tagits i beslag efter beslut av åklagare.",
          translation:
            "A preliminary investigation into suspected gross sabotage has been opened over suspected damage to a communication cable between Sweden and Latvia in the Baltic Sea. A ship suspected of having carried out the sabotage has been seized by decision of a prosecutor.",
        },
        { sourceId: 1, quote: "Publicerad: 26 januari 2025 kl. 20.56", translation: "Published: 26 January 2025 at 20.56." },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2025-01-26T22:35:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "The Swedish Coast Guard says it is assisting the prosecutor and the Security Service",
      citations: [
        {
          sourceId: 5,
          quote:
            "In response to the damaged cable Sunday 26 January in the Baltic Sea, the Swedish Cost Guard is assisting the prosecutor and Swedish Security Service in the preliminary investigation.",
        },
      ],
    },
    {
      atUtc: "2025-01-27T12:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Latvian Navy divers sent to the damage site; Vezhen held off Karlskrona",
      citations: [
        {
          sourceId: 10,
          quote:
            "The Navy divers of the National Armed Forces have been deployed to the site of the cable damage in Sweden's Exclusive Economic Zone to conduct inspections and gather evidence.",
        },
        {
          sourceId: 10,
          quote: "The Swedish Coast Guard has detained the vessel \"Vezhen,\" and the Swedish police have joined the investigation today. The detained vessel is currently in the Swedish port city of Karlskrona.",
        },
      ],
    },
    {
      atUtc: "2025-01-27T15:09:22Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "At anchor 6 km south of Aspö, with Swedish Coast Guard staff on board",
      citations: [
        { sourceId: 19, quote: "27/01/2025 15:09:22,Class A,229659000,56.060892,15.524370,At anchor,0.0,0.0,90.8,172" },
        {
          sourceId: 15,
          quote: "A Swedish coast guard spokesperson said the seized ship is anchored south of Aspo island near Karlskrona, and that coast guard staff have been onboard the ship investigating since Sunday evening.",
        },
      ],
    },
    {
      atUtc: "2025-01-28T14:30:00Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "Latvia's State Police investigate under the criminal law on intentional damage, with sabotage added",
      citations: [
        {
          sourceId: 6,
          quote:
            "(Update 28.01. 16.30) In connection with the damaged LVRTC underwater optical fiber cable in the Baltic Sea, the State Police, in cooperation with the Prosecution office and under its direct supervision, is investigating a criminal proceeding under the second part of Section 185 of the Criminal Law regarding the intentional destruction and damage of property, if this has caused serious consequences",
        },
        { sourceId: 6, quote: "Likewise, the criminal process is additionally qualified according to Section 89 of the Criminal Law on sabotage." },
      ],
    },
    {
      atUtc: "2025-02-03T11:01:00Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "Sweden's prosecutor rules out sabotage, finds the seized ship caused the break, and lifts the seizure",
      citations: [
        {
          sourceId: 3,
          quote:
            "The investigation now clearly shows that it is not a case of sabotage. It has been established that a combination of weather conditions and deficiencies in equipment and seamanship contributed to the cable break.",
        },
        { sourceId: 3, quote: "At the same time, we have been able to establish that it is the ship that was seized that caused the cable break, says Mats Ljungqvist." },
        { sourceId: 2, quote: "Publicerad: 3 februari 2025 kl. 12.01", translation: "Published: 3 February 2025 at 12.01." },
      ],
    },
    {
      atUtc: "2025-02-04T10:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "LVRTC: Latvia's State Police keep their case open; the company will seek its losses",
      citations: [
        {
          sourceId: 7,
          quote:
            "According to the information provided by the State Police, the investigation has not yet yielded any information that would serve as a basis for terminating or requalifying the criminal proceedings.",
        },
        {
          sourceId: 7,
          quote: "LVRTC informs that regardless of the prosecutor's conclusions regarding the reasons for the cable damage, LVRTC property has suffered losses, therefore the company will initiate the process of recovering losses.",
        },
      ],
    },
    {
      atUtc: "2025-02-28T05:00:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "Cable repaired with a new section of several hundred metres; service fully restored",
      citations: [
        {
          sourceId: 8,
          quote:
            "Early this morning, LVRTC engineers and the crew of the submarine fiber optic cable repair vessel have completed the connection of the submarine fiber optic cable, the operation of the cable, the operation of the equipment and connections in Ventspils and Gotland have been tested, and the service to LVRTC customers has now been fully restored.",
        },
        { sourceId: 8, quote: "A new, several hundred meter long cable section has been inserted between the damaged sections, connected with sleeves." },
      ],
    },
    {
      atUtc: "2025-06-21T09:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Latvia's transport accident bureau opens a preliminary assessment and awaits delegation from the flag states",
      citations: [
        {
          sourceId: 11,
          quote:
            "In this context, the Transport Accident and Incident Investigation Bureau, acting within its mandated authority, is awaiting delegation from the relevant flag states (Malta/Norway/Barbados) or other concerned maritime administrations to carry out the investigation of this maritime incident.",
        },
      ],
    },
    {
      atUtc: "2025-10-13T09:04:00Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "Sweden closes its investigation: an accident, not a deliberate act; the case passes to Latvia",
      citations: [
        {
          sourceId: 4,
          quote: "Utredningen visar att det rört sig om en olyckshändelse.",
          translation: "The investigation shows that it was an accident.",
        },
        {
          sourceId: 4,
          quote: "Fartygets ankare skulle normalt ha säkrats av tre av varandra oberoende säkerhetsanordningar. Två av dessa var sedan en tid tillbaka ur funktion.",
          translation: "The ship's anchor would normally have been secured by three independent safety devices. Two of these had been out of order for some time.",
        },
        LOCK_CITATION,
        {
          sourceId: 4,
          quote:
            "Eftersom fartygets autopilot vid tillfället har varit inkopplad har autopiloten kompenserat för detta. Inget larm eller liknande har uppmärksammat personen på kommandobryggan på vad som hänt.",
          translation: "Because the ship's autopilot was engaged at the time, it compensated for this. No alarm or anything similar alerted the person on the bridge to what had happened.",
        },
        {
          sourceId: 4,
          quote: "Vi kan därför dra slutsatsen att kabeln inte har skadats genom ett medvetet handlande. Jurisdiktion för att hantera eventuella vårdslöshetsbrott föreligger inte, säger kammaråklagare Mats Ljungqvist.",
          translation:
            "We can therefore conclude that the cable was not damaged through a deliberate act. There is no jurisdiction to handle any negligence offences, says senior prosecutor Mats Ljungqvist.",
        },
        {
          sourceId: 4,
          quote: "Förundersökningen har under våren 2025 överlämnats till brottsutredande myndigheter i Lettland som bedriver en egen förundersökning om det aktuella kabelbrottet.",
          translation: "In spring 2025 the preliminary investigation was handed over to criminal investigation authorities in Latvia, which are running their own preliminary investigation into the cable break.",
        },
        { sourceId: 4, quote: "Publicerad: 13 oktober 2025 kl. 11.04", translation: "Published: 13 October 2025 at 11.04." },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Åklagarmyndigheten (Swedish Prosecution Authority)",
      title: "Förundersökning inledd efter kabelbrott i Östersjön",
      url: "https://www.aklagare.se/for-media/pressmeddelanden/2025/januari/forundersokning-inledd-efter-kabelbrott-i-ostersjon/",
      publishedOn: "2025-01-26",
      archivedUrl: "https://web.archive.org/web/20250322225016/https://www.aklagare.se/for-media/pressmeddelanden/2025/januari/forundersokning-inledd-efter-kabelbrott-i-ostersjon/",
    },
    {
      id: 2,
      publisher: "Åklagarmyndigheten (Swedish Prosecution Authority)",
      title: "Åklagaren häver beslut om beslagtaget fartyg",
      url: "https://www.aklagare.se/for-media/pressmeddelanden/2025/februari/aklagaren-haver-beslut-om-beslagtaget-fartyg/",
      publishedOn: "2025-02-03",
      archivedUrl: "https://web.archive.org/web/20250616200916/https://www.aklagare.se/for-media/pressmeddelanden/2025/februari/aklagaren-haver-beslut-om-beslagtaget-fartyg/",
    },
    {
      id: 3,
      publisher: "Swedish Prosecution Authority",
      title: "Prosecutor revokes decision on seized ship",
      url: "https://www.aklagare.se/en/for-the-media/press-releases/2025/february/prosecutor-revokes-decision-on-seized-ship",
      publishedOn: "2025-02-03",
      archivedUrl: "https://web.archive.org/web/20250324043633/https://www.aklagare.se/en/for-the-media/press-releases/2025/february/prosecutor-revokes-decision-on-seized-ship/",
    },
    {
      id: 4,
      publisher: "Åklagarmyndigheten (Swedish Prosecution Authority)",
      title: "Förundersökning om grovt sabotage av kommunikationskabel läggs ned",
      url: "https://www.aklagare.se/for-media/pressmeddelanden/2025/oktober/forundersokning-om-grovt-sabotage-av-kommunikationskabel-laggs-ned/",
      publishedOn: "2025-10-13",
      archivedUrl: "https://web.archive.org/web/20251013120811/https://www.aklagare.se/for-media/pressmeddelanden/2025/oktober/forundersokning-om-grovt-sabotage-av-kommunikationskabel-laggs-ned/",
    },
    {
      id: 5,
      publisher: "Swedish Coast Guard (Kustbevakningen)",
      title: "Regarding damaged Baltic Sea cables",
      url: "https://www.kustbevakningen.se/en/more-news/regarding-damaged-baltic-sea-cables/",
      publishedOn: "2025-01-26",
      archivedUrl: "https://web.archive.org/web/20250214043923/https://www.kustbevakningen.se/en/more-news/regarding-damaged-baltic-sea-cables/",
    },
    {
      id: 6,
      publisher: "LVRTC (Latvian State Radio and Television Centre)",
      title: "LVRTC Submarine Optical Fiber Cable Damaged (Updated 01.02. at 10.00)",
      url: "https://www.lvrtc.lv/en/news/jaunumi/lvrtc-submarine-optical-fiber-cable-damaged/",
      publishedOn: "2025-01-26",
      archivedUrl: "https://web.archive.org/web/20250126140752/https://www.lvrtc.lv/en/news/jaunumi/lvrtc-submarine-optical-fiber-cable-damaged/",
    },
    {
      id: 7,
      publisher: "LVRTC (Latvian State Radio and Television Centre)",
      title: "Recovery of Losses for Cable Damage",
      url: "https://www.lvrtc.lv/en/news/jaunumi/recovery-of-losses-for-cable-damage/",
      publishedOn: "2025-02-04",
      archivedUrl: "https://web.archive.org/web/20250209101405/https://www.lvrtc.lv/en/news/jaunumi/recovery-of-losses-for-cable-damage/",
    },
    {
      id: 8,
      publisher: "LVRTC (Latvian State Radio and Television Centre)",
      title: "Submarine Fiber Optic Cable Repair Work (updated 28.02. at 10.25)",
      url: "https://www.lvrtc.lv/en/news/jaunumi/submarine-fiber-optic-cable-repair-work/",
      publishedOn: "2025-02-14",
      archivedUrl: "https://web.archive.org/web/20250213234319/https://www.lvrtc.lv/en/news/jaunumi/submarine-fiber-optic-cable-repair-work/",
    },
    {
      id: 9,
      publisher: "National Armed Forces of Latvia",
      title: "The National Armed Forces monitor the situation involving an submarine optical fiber cable in the Baltic Sea",
      url: "https://www.mil.lv/lv/node/6113",
      publishedOn: "2025-01-26",
      archivedUrl: "https://web.archive.org/web/20251117005759/https://www.mil.lv/lv/node/6113",
    },
    {
      id: 10,
      publisher: "National Armed Forces of Latvia",
      title: "Investigation into Cable Damage in the Baltic Sea Continues",
      url: "https://www.mil.lv/lv/node/6118",
      publishedOn: "2025-01-27",
      archivedUrl: null,
    },
    {
      id: 11,
      publisher: "Transport Accident and Incident Investigation Bureau of Latvia",
      title: "Transport Accident and Incident Investigation Bureau initiates preliminary assessment of damaged submarine cable in the Baltic Sea",
      url: "https://www.taiib.gov.lv/en/article/transport-accident-and-incident-investigation-bureau-initiates-preliminary-assessment-damaged-submarine-cable-baltic-sea",
      publishedOn: "2025-06-21",
      archivedUrl: null,
    },
    {
      id: 12,
      publisher: "LSM (Latvian Public Media)",
      title: "Latvian fiber-optic cable damaged in Baltic sea",
      url: "https://eng.lsm.lv/article/society/defense/26.01.2025-latvian-fiber-optic-cable-damaged-in-baltic-sea.a585218/",
      publishedOn: "2025-01-26",
      archivedUrl: "https://web.archive.org/web/20250126153131/https://eng.lsm.lv/article/society/defense/26.01.2025-latvian-fiber-optic-cable-damaged-in-baltic-sea.a585218/",
    },
    {
      id: 13,
      publisher: "LSM (Latvian Public Media)",
      title: "Preparations underway for repairing damaged Latvian undersea cable",
      url: "https://eng.lsm.lv/article/society/defense/31.01.2025-preparations-underway-for-repairing-damaged-latvian-undersea-cable.a585963/",
      publishedOn: "2025-01-31",
      archivedUrl: "https://web.archive.org/web/20250131160103/https://eng.lsm.lv/article/society/defense/31.01.2025-preparations-underway-for-repairing-damaged-latvian-undersea-cable.a585963/",
    },
    {
      id: 14,
      publisher: "LSM (Latvian Public Media)",
      title: "Sweden closes case on Latvian undersea cable damage",
      url: "https://eng.lsm.lv/article/society/crime/14.10.2025-sweden-closes-case-on-latvian-undersea-cable-damage.a618218/",
      publishedOn: "2025-10-14",
      archivedUrl: "https://web.archive.org/web/20251015123910/https://eng.lsm.lv/article/society/crime/14.10.2025-sweden-closes-case-on-latvian-undersea-cable-damage.a618218/",
    },
    {
      id: 15,
      publisher: "Baird Maritime (Reuters)",
      title: "Swedish authorities board ship seized over Baltic Sea cable breach",
      url: "https://www.bairdmaritime.com/security/incidents/swedish-authorities-board-ship-seized-over-baltic-sea-cable-breach-2",
      publishedOn: "2025-01-27",
      archivedUrl: "https://web.archive.org/web/20250715232027/https://www.bairdmaritime.com/security/incidents/swedish-authorities-board-ship-seized-over-baltic-sea-cable-breach-2",
    },
    {
      id: 16,
      publisher: "The Insider",
      title: "Bulgarian owner of vessel seized by Sweden over Latvian cable damage claims accident, says anchor dropped to seabed in high winds",
      url: "https://theins.press/en/news/278263",
      publishedOn: "2025-01-27",
      archivedUrl: "https://web.archive.org/web/20250127164134/https://theins.press/en/news/278263",
    },
    {
      id: 17,
      publisher: "TV4 Nyheterna",
      title: "Navibulgar vd: Därför släpades ankaret i Östersjön",
      url: "https://www.tv4.se/artikel/14Lxk3yqHksvFnhQBrn3GU/rederiets-vd-daerfoer-slaepades-ankaret-i-oestersjoen",
      publishedOn: "2025-01-27",
      archivedUrl: "https://web.archive.org/web/20250127112549/https://www.tv4.se/artikel/14Lxk3yqHksvFnhQBrn3GU/rederiets-vd-daerfoer-slaepades-ankaret-i-oestersjoen",
    },
    {
      id: 18,
      publisher: "Danish Maritime Authority",
      title: "AIS data archive, aisdk-2025-01-26.zip",
      url: "https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/2025/aisdk-2025-01-26.zip",
      publishedOn: "2025-07-21",
      archivedUrl: null,
    },
    {
      id: 19,
      publisher: "Danish Maritime Authority",
      title: "AIS data archive, aisdk-2025-01-27.zip",
      url: "https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/2025/aisdk-2025-01-27.zip",
      publishedOn: "2025-07-21",
      archivedUrl: null,
    },
  ],
};
