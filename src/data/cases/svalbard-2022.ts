import type { CableCase } from "@/lib/cases/case-file";
import { MELKART_5_AIS_FIXES } from "@/data/cases/svalbard-2022-ais";

// The Svalbard cable fault, 7 January 2022. Sources, quotes and the arithmetic behind each placement:
// plan/research/cases/svalbard-2022.md (source ids below keep that file's numbering). Norway used CET (UTC+1);
// every time here is UTC.
// Police leaned toward human activity, then closed the case as no criminal offence: no one was charged, and they
// found nothing pointing to a deliberate act. The case keeps those words and never says the trawler cut the cable.
// The trawler's own AIS track comes from the Norwegian Coastal Administration's open API; no source places the
// fault more precisely than a 100 km stretch, so the cut marker is that stretch's midpoint and says so.

const OUTAGE_CITATION = {
  sourceId: 1,
  quote: "Fra kl. 04:10 fredag 7. januar 2022 har en av de to forbindelsene på Svalbardfiberen vært ute av funksjon.",
  translation: "From 04:10 on Friday 7 January 2022, one of the two connections on the Svalbard fibre has been out of service.",
};
const OUTAGE_CET_CITATION = { sourceId: 2, quote: "At 04:10 CET on Friday, January 7th, 2022, one of the two connections experienced a failure." };
const STRETCH_CITATION = {
  sourceId: 1,
  quote:
    "Det har vært gjennomført feilsøking fra feilen ble oppdaget, og det ble fredag kveld ca. kl 20:00 fastslått at det er feil på strømmatingen mellom 130 og 230 km fra Longyearbyen og i et område hvor kabelen går bratt ned i dyphavet fra ca. 300 m til ca. 2700 meters dybde.",
  translation:
    "Fault-finding has been under way since the fault was discovered, and on Friday evening at about 20:00 it was established that there is a fault in the power feed between 130 and 230 km from Longyearbyen, in an area where the cable runs steeply down into the deep sea from about 300 m to about 2,700 metres depth.",
};
const DEPTH_CITATION = {
  sourceId: 6,
  quote:
    "Ingen vet nøyaktig hvor skaden har oppstått, men feilen på kabelen skal ligge på et dyp mellom 500 m og over 2000 m, opplyser eier av kabelen, Space Norway.",
  translation: "No one knows exactly where the damage occurred, but the fault on the cable lies at a depth between 500 m and over 2,000 m, says the cable's owner, Space Norway.",
};
const TWO_CABLES_CITATION = {
  sourceId: 2,
  quote: "The Svalbard fibre system is built as a fully redundant solution with two cables separated approximately 5-10 km on the seabed.",
};
const TRAWLER_IN_AREA_CITATION = {
  sourceId: 5,
  quote: "Under etterforskningen har vi også foretatt avhør av skipper på en russisk tråler som var i det aktuelle området ved signalutfallet",
  translation: "During the investigation we also questioned the skipper of a Russian trawler that was in the area in question when the signal was lost",
};
const CROSSINGS_CITATION = {
  sourceId: 6,
  quote: "I dagene før og etter at kabelen ble skadet har «Melkart 5» passert tjue ganger over kablene.",
  translation: "In the days before and after the cable was damaged, «Melkart 5» passed over the cables twenty times.",
};
const FIRST_FIX_CITATION = { sourceId: 9, quote: '[273418680,"2022-01-07T00:00:08",9.54552,78.32530,155.5,3.5,1,-99.0,-99,-99,158,0]' };
const NOT_DELIBERATE_CITATION = {
  sourceId: 5,
  quote: "Politiet har ikke gjort noen funn som tilsier at skaden på kabelen er en villet handling.",
  translation: "The police have made no findings indicating that the damage to the cable is a deliberate act.",
};

export const SVALBARD_2022: CableCase = {
  slug: "svalbard-2022",
  title: "Svalbard cable fault",
  subtitle: "West of Spitsbergen, 7 January 2022",
  summary:
    "At 04:10 Norwegian time one of the two Svalbard cables lost its connection, and Space Norway placed a power-feed fault 130 to 230 km from Longyearbyen, where the cable drops from about 300 m to 2,700 m. The Russian trawler Melkart-5, whose recorded AIS track replays here, was fishing back and forth across both cables that night. Police leaned toward human activity, then closed the case as no criminal offence: no one was charged, and they found nothing pointing to a deliberate act.",
  vessel: {
    name: "Melkart-5",
    kind: "general-cargo",
    flag: "Russia",
    type: "Fishing vessel (trawler), 53.2 m",
    lengthMetres: 53.2,
    imo: "9130183",
    mmsi: "273418680",
    citations: [
      { sourceId: 10, quote: "The vessel MELKART-5 (IMO 9130183, MMSI 273418680) is a Fishing Vessel built in 1996" },
      { sourceId: 10, quote: "Length Overall (m) 53.20" },
      {
        sourceId: 6,
        quote: "Blant dem tråleren «Melkart 5». I flere dager har den gjentatte ganger krysset kabelen.",
        translation: "Among them the trawler «Melkart 5». For several days it has repeatedly crossed the cable.",
      },
      FIRST_FIX_CITATION,
    ],
  },
  window: { startUtc: "2022-01-07T00:00:08Z", endUtc: "2022-01-07T19:30:00Z" },
  localTime: { place: "Longyearbyen", timeZone: "Arctic/Longyearbyen" },
  seabedArea: "svalbard",
  // Every position below is the ship's own AIS; no position is placed from statements.
  track: [],
  recordedTrack: {
    selection:
      "Rows with MMSI 273418680 that the Norwegian Coastal Administration's open AIS API returns for 5 to 9 January 2022, 00:00 to 19:30 UTC on 7 January, the first of every 5 minutes and the last row. The API states its times in UTC. One row on 6 January (22:20:41, 71.57 N) jumps 744 km and is dropped as a receiver glitch; none falls inside the window.",
    citations: [FIRST_FIX_CITATION],
    fixes: MELKART_5_AIS_FIXES,
  },
  // The cable was not hit by an anchor: no source describes one, so no drag window is drawn.
  dragWindow: null,
  cuts: [
    {
      cableName: "Svalbard Undersea Cable System",
      label: "Svalbard cable (one of two)",
      owner: "Space Norway",
      atUtc: "2022-01-07T03:10:00Z",
      longitude: 8.28025,
      latitude: 78.29284,
      precision: "area",
      placement:
        "Space Norway places the fault anywhere between 130 and 230 km from Longyearbyen and does not say which of the two cables failed. The marker is the stretch's midpoint, 180 km along the northern mapped route (OpenStreetMap way 549813459) from its Longyearbyen landing; the depth grid reads 2,114 m there, inside the 500 to over 2,000 m Space Norway gave NRK. The stretch runs from 78.28747 N 10.43241 E (321 m) to 77.86907 N 8.05541 E (2,721 m), so the true fault may lie up to 50 km of cable either way.",
      citations: [STRETCH_CITATION, DEPTH_CITATION, OUTAGE_CITATION, TWO_CABLES_CITATION],
    },
  ],
  events: [
    {
      atUtc: "2022-01-07T00:00:08Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "AIS: Melkart-5 trawling at 3.5 knots over the cables' shelf-edge crossing, 138 km west of Longyearbyen",
      citations: [FIRST_FIX_CITATION, CROSSINGS_CITATION],
    },
    {
      atUtc: "2022-01-07T03:10:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "One of the two Svalbard connections fails; police later say a Russian trawler was in the area at that moment",
      citations: [
        OUTAGE_CITATION,
        OUTAGE_CET_CITATION,
        TRAWLER_IN_AREA_CITATION,
        { sourceId: 9, quote: '[273418680,"2022-01-07T03:10:05",9.55722,78.32890,158.5,3.6,1,3.9,6,12,162,0]' },
      ],
    },
    {
      atUtc: "2022-01-07T19:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Space Norway locates a power-feed fault 130 to 230 km from Longyearbyen, on the steep drop to the deep sea",
      citations: [STRETCH_CITATION],
    },
  ],
  aftermath: [
    {
      atUtc: "2022-01-08T16:53:48Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "AIS: Melkart-5 leaves the cable area southward at 10.7 knots; police later say the trawler moved its fishing at the Governor's request",
      citations: [
        { sourceId: 9, quote: '[273418680,"2022-01-08T16:53:48",9.67628,78.28280,175.3,10.7,1,10.7,10,55,178,720]' },
        {
          sourceId: 5,
          quote: "Etter henstilling fra Sysselmesteren flyttet tråleren fiskeriaktiviteten fra området.",
          translation: "At the Governor of Svalbard's request, the trawler moved its fishing away from the area.",
        },
      ],
    },
    {
      atUtc: "2022-01-10T14:30:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Police investigate the fault as possibly criminal; Space Norway still searching a 100 km span of cable",
      citations: [
        {
          sourceId: 3,
          quote: "Det er noe vi etterforsker som noe mulig straffbart, sier politiadvokat Ronny Jørgensen i Troms politidistrikt.",
          translation: "It is something we are investigating as possibly criminal, says police lawyer Ronny Jørgensen of Troms police district.",
        },
        {
          sourceId: 3,
          quote: "Men det er et spenn på cirka hundre kilometer langs kabelen vi søker i, så det har vi ennå ikke fått fastslått.",
          translation: "But there is a span of about a hundred kilometres along the cable that we are searching, so we have not yet established it.",
        },
      ],
    },
    {
      atUtc: "2022-01-18T18:00:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "Redundancy restored by feeding power from Svalbard; the fault is a shunt that cut power to some repeaters",
      citations: [
        { sourceId: 2, quote: "The analysis of the failure indicated a shunt failure in the cable causing loss of power to some of the signal repeaters." },
        {
          sourceId: 2,
          quote: "Through a workaround applying an alternate power supply to the damaged cable, the redundancy was restored during the evening of January 18th, 2022.",
        },
      ],
    },
    {
      atUtc: "2022-02-11T05:54:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Police: findings point to external influence rather than nature; no one charged or suspected, nothing pointing to a deliberate act",
      citations: [
        {
          sourceId: 4,
          quote: "De foreløpige undersøkelsene styrker hypotesen om at det er ytre påvirkning som har ført til at den ene kabelen mistet forbindelsen.",
          translation: "The preliminary investigations strengthen the hypothesis that external influence caused one of the cables to lose its connection.",
        },
        { sourceId: 4, quote: "Ingen er så langt siktet eller mistenkt i saken.", translation: "No one has so far been charged or suspected in the case." },
        {
          sourceId: 4,
          quote: "Jørgensen forteller til NRK at de foreløpig ikke har gjort noen funn som tilsier at skaden på kabelen er en villet handling.",
          translation: "Jørgensen tells NRK that so far they have made no findings indicating that the damage to the cable is a deliberate act.",
        },
      ],
    },
    {
      atUtc: "2022-03-21T11:01:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Police close the case as no criminal offence; trawl-door marks seen near the cable, no link to the signal loss shown",
      citations: [
        {
          sourceId: 5,
          quote:
            "Politiet har ikke funnet beviser nok for at det var menneskelig aktivitet som førte til brudd i en sjøkabel mellom Norge og Svalbard. Nå henlegges saken som intet straffbart forhold.",
          translation:
            "The police have not found enough evidence that human activity caused the break in a subsea cable between Norway and Svalbard. The case is now closed as no criminal offence.",
        },
        {
          sourceId: 5,
          quote:
            "Selve kabelen på det aktuelle strekket ble ikke lokalisert, men spor på havbunnen kan tyde på at en tråldør har vært i området over kabelen. Det er likevel ikke påvist noe sammenheng mellom signalutfallet og trålingen, sier Jørgensen.",
          translation:
            "The cable itself on the stretch in question was not located, but marks on the seabed may suggest that a trawl door has been in the area above the cable. Even so, no connection between the signal loss and the trawling has been shown, says Jørgensen.",
        },
        NOT_DELIBERATE_CITATION,
      ],
    },
    {
      atUtc: "2022-10-08T15:18:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "NRK: Melkart-5's AIS crossed the cables more than 107 times in the first nine days of January; its owner denies any link",
      citations: [
        {
          sourceId: 7,
          quote: "I løpet av de ni første dagene i januar krysset tråleren «Melkart-5» kablene mer enn 107 ganger.",
          translation: "During the first nine days of January the trawler «Melkart-5» crossed the cables more than 107 times.",
        },
        {
          sourceId: 7,
          quote: "Kapteinen sier de ikke hadde noe med at fiberkabelen mellom Svalbard og fastlandet mistet sin forbindelse den 7. januar i år.",
          translation: "The captain says they had nothing to do with the fibre cable between Svalbard and the mainland losing its connection on 7 January this year.",
        },
      ],
    },
    {
      atUtc: "2023-06-15T12:00:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "The cable is raised and repaired from the ship Cable Vigilance; the damage is found after 40 hours",
      citations: [
        { sourceId: 8, quote: "However, Frorud will speak about how they found and repaired the damaged cable in June of last year." },
        { sourceId: 8, quote: "After 40 hours they had found the damage." },
      ],
    },
    {
      atUtc: "2024-05-26T16:56:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Police photos made public: experts read crushing damage; Space Norway accepts that police could not prove human activity",
      citations: [
        { sourceId: 8, quote: "Police prosecutor Ronny Jørgensen confirms that the police's technical report also identifies «pinching damage» as a possible cause of the malfunction." },
        { sourceId: 8, quote: "After an inital investigation, the police dropped the case due to lack of evidence, and inadequate legislation." },
        {
          sourceId: 8,
          quote:
            "«Space Norway acknowledges the conclusion of the investigation. The police cannot prove that this was as a result of human activity. So, we have taken note of that conclusion, and we are not speculating further,» says Jensen.",
        },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Space Norway",
      title: "Pressemelding om Svalbardkabelen 07.01.2022: Bortfall av reservekapasitet på Svalbardfiberen",
      url: "https://spacenorway.no/",
      publishedOn: "2022-01-07",
      archivedUrl: "https://web.archive.org/web/20220111023548/https://spacenorway.no/",
    },
    {
      id: 2,
      publisher: "Space Norway",
      title: "Redundancy on primary telecom connection to Svalbard restored",
      url: "https://spacenorway.no/en/redundancy-on-primary-telecom-connection-to-svalbard-restored/",
      publishedOn: "2022-03-01",
      archivedUrl: "https://web.archive.org/web/20220707124838/https://spacenorway.no/en/redundancy-on-primary-telecom-connection-to-svalbard-restored/",
    },
    {
      id: 3,
      publisher: "NRK",
      title: "Én av to internettforbindelser på Svalbard er ute av drift, saken politietterforskes",
      url: "https://www.nrk.no/tromsogfinnmark/en-av-to-internettforbindelser-pa-svalbard-er-ute-av-drift-_-saken-politietterforskes-1.15803310",
      publishedOn: "2022-01-10",
      archivedUrl: "https://web.archive.org/web/20261017163010/https://www.nrk.no/tromsogfinnmark/en-av-to-internettforbindelser-pa-svalbard-er-ute-av-drift-_-saken-politietterforskes-1.15803310",
    },
    {
      id: 4,
      publisher: "NRK",
      title: "Politiet tror det er en menneskelig årsak bak bruddet på sjøkabel på Svalbard",
      url: "https://www.nrk.no/tromsogfinnmark/politiet-tror-det-er-en-menneskelig-arsak-bak-bruddet-pa-sjokabel-pa-svalbard-1.15850988",
      publishedOn: "2022-02-11",
      archivedUrl: "https://web.archive.org/web/20261017163153/https://www.nrk.no/tromsogfinnmark/politiet-tror-det-er-en-menneskelig-arsak-bak-bruddet-pa-sjokabel-pa-svalbard-1.15850988",
    },
    {
      id: 5,
      publisher: "NRK",
      title: "Kabelbruddet på Svalbard forblir et mysterium: politiet henlegger saken",
      url: "https://www.nrk.no/tromsogfinnmark/kabelbruddet-pa-svalbard-forblir-et-mysterium-_-politiet-henlegger-saken-1.15893095",
      publishedOn: "2022-03-21",
      archivedUrl: "https://web.archive.org/web/20261017163336/https://www.nrk.no/tromsogfinnmark/kabelbruddet-pa-svalbard-forblir-et-mysterium-_-politiet-henlegger-saken-1.15893095",
    },
    {
      id: 6,
      publisher: "NRK",
      title: "Russiske trålere krysset begge kablene før forbindelsen forsvant",
      url: "https://www.nrk.no/nordland/xl/russiske-tralere-krysset-kabler-i-vesteralen-og-svalbard-for-brudd-1.16007084",
      publishedOn: "2022-06-26",
      archivedUrl: "https://web.archive.org/web/20261017163507/https://www.nrk.no/nordland/xl/russiske-tralere-krysset-kabler-i-vesteralen-og-svalbard-for-brudd-1.16007084",
    },
    {
      id: 7,
      publisher: "NRK",
      title: "Én russisk fisketråler har krysset Svalbardfiberen mer enn 140 ganger",
      url: "https://www.nrk.no/nordland/den-russiske-fisketraleren-_melkart-5_-krysset-svalbardfiberen-over-140-ganger-1.16128138",
      publishedOn: "2022-10-08",
      archivedUrl: "https://web.archive.org/web/20261017163646/https://www.nrk.no/nordland/den-russiske-fisketraleren-_melkart-5_-krysset-svalbardfiberen-over-140-ganger-1.16128138",
    },
    {
      id: 8,
      publisher: "NRK",
      title: "This is what the damaged Svalbard cable looked like when it came up from the depths",
      url: "https://www.nrk.no/tromsogfinnmark/this-is-what-the-damaged-svalbard-cable-looked-like-when-it-came-up-from-the-depths-1.16895904",
      publishedOn: "2024-05-26",
      archivedUrl: "https://web.archive.org/web/20261017163810/https://www.nrk.no/tromsogfinnmark/this-is-what-the-damaged-svalbard-cable-looked-like-when-it-came-up-from-the-depths-1.16895904",
    },
    // A POST answer cannot be captured by the Wayback Machine; the title carries the request so anyone can repeat it.
    {
      id: 9,
      publisher: "Norwegian Coastal Administration (Kystverket), Kystdatahuset open API",
      title: 'AIS positions, POST /ws/api/ais/positions/for-mmsis-time {"mmsiIds":[273418680],"start":"202201050000","end":"202201092359"}',
      url: "https://kystdatahuset.kystverket.no/ws/api/ais/positions/for-mmsis-time",
      publishedOn: "2026-10-17",
      archivedUrl: null,
    },
    {
      id: 10,
      publisher: "VesselFinder",
      title: "MELKART-5, Fishing Vessel, IMO 9130183",
      url: "https://www.vesselfinder.com/vessels/details/9130183",
      publishedOn: "2026-10-17",
      archivedUrl: "https://web.archive.org/web/20261017163944/https://www.vesselfinder.com/vessels/details/9130183",
    },
  ],
};
