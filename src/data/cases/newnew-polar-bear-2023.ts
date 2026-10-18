import type { CableCase } from "@/lib/cases/case-file";

// The Balticconnector and EE-S1 damage, 7 and 8 October 2023. Sources, quotes, conflicts and the arithmetic
// behind each placement: plan/research/cases/balticconnector-2023.md (source ids below keep that file's
// numbering). Finland and Estonia used EEST (UTC+3), Sweden CEST (UTC+2); every time here is UTC.
// No authority published a coordinate or a track. The two positions are placed on the mapped routes from written
// descriptions: the EE-S1 route itself is read off Yle's map (scripts/seabed/build-seabed.ts, EE_S1_TRACED).

const EE_S1_CROSSING_CITATION = {
  sourceId: 8,
  quote: "Marine Trafficin tiedot osoittavat, että alukset ylittivät tietoliikennekaapelin alkuillasta. Newnew Polar Bear kulki sen yli noin kello 18 ja Sevmorput noin 20 Suomen aikaa.",
  translation: "MarineTraffic data show that the ships crossed the telecommunications cable early in the evening. Newnew Polar Bear passed over it at about 18 and Sevmorput at about 20 Finnish time.",
};
const EE_S1_PLACE_CITATION = {
  sourceId: 8,
  quote: "Viron talous- ja viestintäministeriön mukaan vaurio tapahtui noin 50 kilometriä länteen Hiidenmaalta.",
  translation: "According to Estonia's Ministry of Economic Affairs and Communications, the damage happened about 50 kilometres west of Hiiumaa.",
};
const EE_S1_AFTERNOON_CITATION = {
  sourceId: 8,
  quote: 'Ruotsin ja Viron välisen EE-S1 tietoliikennekaapelin omistava Arelion on kertonut Ruotsin yleisradiolle (SVT), että kaapelia vahingoitettiin lauantaina 7. lokakuuta "på eftermiddagen".',
  translation: 'Arelion, which owns the EE-S1 telecommunications cable between Sweden and Estonia, has told the Swedish broadcaster SVT that the cable was damaged on Saturday 7 October "på eftermiddagen" (in the afternoon).',
};
const ROUTE_NEAR_HIIUMAA_CITATION = {
  sourceId: 8,
  quote: "Alusten reitti kulki huomattavan läheltä Hiidenmaata muihin liikkeellä olleisiin aluksiin verrattuna, saaren keskeltä mitattuna noin 60 kilometrin päässä.",
  translation: "The ships' route ran notably close to Hiiumaa compared with other ships under way, about 60 kilometres from the centre of the island.",
};
const EE_S1_EEZ_CITATION = { sourceId: 10, quote: "The damage occurred within the Estonian economic zone." };
const SEISMIC_CITATION = {
  sourceId: 7,
  quote: "Data shows a clear event at 01:20, Finnish time, which corresponds with the approximate time that the media reports a drop in pressure in the pipeline.",
};
const SEISMIC_PLACE_CITATION = {
  sourceId: 7,
  quote: "The event has been located approximately 40 km north of Paldiski, Estonia close to where the Baltic Connector pipeline crosses the Nord Stream 1 pipeline.",
};
const BETWEEN_NORD_STREAM_CITATION = {
  sourceId: 11,
  quote: "The Balticconnector crosses the Nord Stream gas pipelines 1 A and 1 B which are placed 900 meters apart and the damage is closer to 1 A.",
};
const FINNISH_EEZ_CITATION = {
  sourceId: 6,
  quote: "The location of the leak in the Balticconnector gas pipeline between Finland and Estonia was identified in Finland's exclusive economic zone on 10 October 2023.",
};
const DEPTH_CITATION = { sourceId: 12, quote: "The damage site was located at a depth of 60 metres on the seabed." };
const MOVEMENTS_CITATION = {
  sourceId: 2,
  quote: "The police have established in the criminal investigation that the movements of the vessel Newnew Polar Bear flying the flag of Hong Kong coincide with the time and place of the gas pipeline damage.",
};
const DRAG_TRAIL_CITATION = {
  sourceId: 3,
  quote: "General Head of Investigation Detective Superintendent Risto Lohi described that on the seabed, a 1.5 to 4 metre-wide dragging trail is seen to lead to the point of damage in the gas pipeline.",
};
const ANCHOR_BESIDE_CITATION = {
  sourceId: 3,
  quote: "In the distance of a few metres from the gas pipeline damage point, there was an anchor which is believed to have caused the wide dragging trail and the damage itself.",
};
const DRAG_CROSSES_CABLES_CITATION = {
  sourceId: 11,
  quote:
    '"The drag marks cross the [damaged] Estonia-Sweden and Estonia-Finland communications cables, which is why we have reason to believe the damage the cables have sustained is a result of this," public prosecutor Triinu Olev told ERR Monday.',
};

export const NEWNEW_POLAR_BEAR_2023: CableCase = {
  slug: "newnew-polar-bear-2023",
  title: "Newnew Polar Bear anchor drag",
  subtitle: "Off Hiiumaa and in the Gulf of Finland, 7 and 8 October 2023",
  summary:
    "The container ship Newnew Polar Bear sailed from Kaliningrad toward St Petersburg on 7 October 2023. The EE-S1 cable west of Hiiumaa was damaged that afternoon and the Balticconnector gas pipeline at 01:20 Finnish time; Finnish investigators lifted a broken anchor beside the pipeline and say it is the ship's, and the captain has pleaded not guilty in Hong Kong. No ship positions were published, so the two points below are placed from statements.",
  vessel: {
    name: "Newnew Polar Bear",
    kind: "container-ship",
    flag: "Hong Kong",
    type: "Container ship, 169 m",
    lengthMetres: 169,
    imo: "9313204",
    mmsi: "477893800",
    citations: [
      {
        sourceId: 19,
        quote:
          "01/10/2023 18:28:31,Class A,477893800,57.696020,7.717532,Under way using engine,0.0,13.7,91.0,91,9313204,VRVQ4,NEWNEW POLAR BEAR,Cargo,Reserved for future use,27,169,GPS,8.5,RU KGD,04/10/2023 02:00:00,AIS,159,10,12,15",
      },
      {
        sourceId: 8,
        quote: "Vuonna 2005 käyttöönotetun Newnew Polar Bearin kyytiin mahtuu 1600 konttia. Se on 169 metriä pitkä ja 27 metriä leveä.",
        translation: "Newnew Polar Bear, in service since 2005, carries 1,600 containers. It is 169 metres long and 27 metres wide.",
      },
      MOVEMENTS_CITATION,
      {
        sourceId: 8,
        quote: "Itämeren vaurioden tapahtuessa alus oli juuri päättänyt kuusi viikkoa kestäneen matkaansa Kiinasta Venäjän Kaliningradiin, ja jatkoi matkaansa Pietariin.",
        translation: "When the Baltic Sea damage happened, the ship had just finished a six-week voyage from China to Kaliningrad in Russia, and was continuing to St Petersburg.",
      },
    ],
  },
  window: { startUtc: "2023-10-07T14:45:00Z", endUtc: "2023-10-07T22:45:00Z" },
  localTime: { place: "Helsinki", timeZone: "Europe/Helsinki" },
  seabedArea: "gulf-of-finland-and-hiiumaa",
  track: [
    {
      atUtc: "2023-10-07T15:00:00Z",
      longitude: 21.30112,
      latitude: 59.16763,
      precision: "area",
      place: "Over EE-S1, about 50 km west of Hiiumaa",
      placement:
        "On the EE-S1 route read off Yle's map, the point 50.0 km from Ristna lighthouse, Hiiumaa's western tip (Nominatim, 58.94005 N, 22.05530 E). Time: the MarineTraffic crossing at about 18:00 Finnish time. The straight line from here to the pipeline passes 56 km from the island's centre, against Yle's 'about 60 kilometres'.",
      citations: [EE_S1_CROSSING_CITATION, EE_S1_PLACE_CITATION, EE_S1_EEZ_CITATION, ROUTE_NEAR_HIIUMAA_CITATION],
    },
    {
      atUtc: "2023-10-07T22:20:00Z",
      longitude: 24.07882,
      latitude: 59.67483,
      precision: "area",
      place: "Over the Balticconnector, between the two Nord Stream 1 lines",
      placement:
        "Midway between the mapped Balticconnector's two crossings of Nord Stream 1 (EMODnet, 953 m apart; Elering says 900 m): 36.2 km north of Paldiski (NORSAR: about 40 km), 1.7 km inside Finland's zone (Marine Regions treaty line), 58 m deep on the EMODnet grid (Yle: 60 m). Time: NORSAR's 01:20 Finnish time. 167 km from the EE-S1 point in 7 h 20 min is 12.3 knots.",
      citations: [SEISMIC_CITATION, SEISMIC_PLACE_CITATION, BETWEEN_NORD_STREAM_CITATION, FINNISH_EEZ_CITATION, DEPTH_CITATION, MOVEMENTS_CITATION],
    },
  ],
  // The Danish archive holds rows for this ship on 1 October 2023 off Norway, none were read for 6 to 8 October
  // (plan/research/historical-ais-coverage.md), and no free archive covers the gulf.
  recordedTrack: null,
  dragWindow: {
    startUtc: "2023-10-07T15:00:00Z",
    endUtc: "2023-10-07T22:20:00Z",
    citations: [DRAG_CROSSES_CABLES_CITATION, DRAG_TRAIL_CITATION, ANCHOR_BESIDE_CITATION],
  },
  // In time order: EE-S1 failed first, so it is the primary cut the replay's signal and close-up show; the
  // Balticconnector is a pipeline, which the overview marks as damaged rather than cut.
  cuts: [
    {
      cableName: "EE-S1",
      label: "EE-S1",
      owner: "Arelion",
      atUtc: "2023-10-07T15:00:00Z",
      longitude: 21.30112,
      latitude: 59.16763,
      precision: "area",
      placement:
        "The point of the EE-S1 route read off Yle's map 50 km from Hiiumaa's western tip. Arelion gives only 'the afternoon'; the time is when MarineTraffic shows the ship over the cable. The route is good to a few kilometres.",
      citations: [EE_S1_AFTERNOON_CITATION, EE_S1_PLACE_CITATION, EE_S1_EEZ_CITATION, EE_S1_CROSSING_CITATION],
    },
    {
      cableName: "Balticconnector",
      label: "Balticconnector",
      owner: "Gasgrid Finland and Elering",
      atUtc: "2023-10-07T22:20:00Z",
      longitude: 24.07882,
      latitude: 59.67483,
      precision: "area",
      placement:
        "Midway between the two crossings of the mapped Balticconnector and Nord Stream 1 routes (EMODnet), where Elering puts the damage 'closer to 1 A'; which EMODnet line is A is not recorded, so the midpoint stands within 480 m of the damage. The time is NORSAR's seismic event.",
      citations: [
        BETWEEN_NORD_STREAM_CITATION,
        SEISMIC_CITATION,
        SEISMIC_PLACE_CITATION,
        FINNISH_EEZ_CITATION,
        {
          sourceId: 6,
          quote: "The Balticconnector gas pipeline was shut down at midnight on 8 October when gas transmission companies Gasgrid in Finland and Elering in Estonia detected a breach.",
        },
      ],
    },
  ],
  events: [
    {
      atUtc: "2023-10-07T15:00:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Newnew Polar Bear crosses the EE-S1 cable west of Hiiumaa",
      citations: [EE_S1_CROSSING_CITATION, ROUTE_NEAR_HIIUMAA_CITATION],
    },
    {
      atUtc: "2023-10-07T15:00:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "EE-S1 is damaged that afternoon, Arelion says",
      citations: [EE_S1_AFTERNOON_CITATION, EE_S1_PLACE_CITATION],
    },
    {
      atUtc: "2023-10-07T17:00:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Sevmorput, the other ship investigators looked at, crosses the same cable",
      citations: [
        EE_S1_CROSSING_CITATION,
        {
          sourceId: 1,
          quote:
            "Investigation measures have been focused on several vessels, such as Newnew Polarbear and Sevmorput, but also on others which according to data have been in the area at the time of the damage, states Detective Superintendent Risto Lohi from the National Bureau of Investigation.",
        },
      ],
    },
    {
      atUtc: "2023-10-07T22:20:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "A seismic signal near the pipeline as its pressure drops",
      citations: [
        SEISMIC_CITATION,
        { sourceId: 12, quote: "Elering and the Finnish transmission network company Gasgrid closed the Balticconnector in the early hours of 8 October due to a sudden drop in pressure." },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2023-10-09T09:00:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "A photo in St Petersburg shows the ship's port anchor chain on the quay side",
      citations: [
        {
          sourceId: 18,
          quote:
            "Suspicions were raised further when a photo of the vessel docked in the port of St Petersburg appeared on the Russian Port News website on 9 October, one day after the damage to the pipeline occurred.",
        },
      ],
    },
    {
      atUtc: "2023-10-10T15:28:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Finland locates the leak in its economic zone; Elisa's Finland to Estonia cable also has a fault",
      citations: [
        FINNISH_EEZ_CITATION,
        { sourceId: 6, quote: "Traficom received information from Elisa, the company that owns the submarine cable, on damage to the cable on Sunday 8 October." },
        { sourceId: 6, quote: "It is very likely that the fault is located in Estonia's exclusive economic zone." },
      ],
    },
    {
      atUtc: "2023-10-17T15:18:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Investigators name Newnew Polar Bear and Sevmorput among the ships in the area",
      citations: [
        {
          sourceId: 1,
          quote:
            "Investigation measures have been focused on several vessels, such as Newnew Polarbear and Sevmorput, but also on others which according to data have been in the area at the time of the damage, states Detective Superintendent Risto Lohi from the National Bureau of Investigation.",
        },
      ],
    },
    {
      atUtc: "2023-10-17T18:03:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Sweden says EE-S1 was damaged outside its waters, about 50 km west of Hiiumaa",
      citations: [
        {
          sourceId: 9,
          quote:
            "The damage to the Swedish-Estonian cable was sustained outside the territorial waters and exclusive economic zone of Sweden, the country's civil defense minister, Carl-Oskar Bohlin said, and the cable continues to function since then.",
        },
        { sourceId: 9, quote: "Estonian Economic Affairs and Communications Ministry told Estonia's public broadcaster ERR that the damage occurred on a cable to Sweden some 50 km (30 miles) west of Hiiumaa Island." },
      ],
    },
    {
      atUtc: "2023-10-20T14:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "The investigation focuses on Newnew Polar Bear",
      citations: [MOVEMENTS_CITATION],
    },
    {
      atUtc: "2023-10-23T16:47:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Sweden: EE-S1 was damaged by external force, in Estonia's economic zone",
      citations: [{ sourceId: 10, quote: "It has been confirmed that the cable has been damaged through external force or tampering." }, EE_S1_EEZ_CITATION],
    },
    {
      atUtc: "2023-10-24T04:00:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "A broken anchor is lifted from beside the pipeline damage",
      citations: [
        { sourceId: 3, quote: "Early this morning the anchor was lifted up. There are traces in it which indicate that it has been in contact with the gas pipeline, Lohi says." },
        ANCHOR_BESIDE_CITATION,
        { sourceId: 3, quote: "Besides we could not visually confirm that both front anchors of the vessel were in their place, which helped in focusing the suspicions on this particular ship, Lohi says." },
      ],
    },
    {
      atUtc: "2023-10-24T14:46:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "Finnish police could not stop the ship in the economic zone",
      citations: [
        {
          sourceId: 3,
          quote: "The police had no competence to take any coercive measures against the vessel, since it sailed in the exclusive economic zone of Finland, which is out of the police competence in this respect, Lohi says.",
        },
      ],
    },
    {
      atUtc: "2023-11-10T09:57:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "The anchor fits Newnew Polar Bear's, with the pipeline's paint on it",
      citations: [
        {
          sourceId: 4,
          quote:
            "At this stage we can state that the anchor lifted from the sea on 24 October 2023, may for some technical details be considered to belong to Newnew Polar Bear. In the said anchor, same type of paint has also been detected as in the damaged gas pipeline, Detective Superintendent Risto Lohi says.",
        },
        {
          sourceId: 18,
          quote:
            "The initial probe also revealed the presence of a wide drag mark on the seabed on one side of the damaged pipeline, and a narrow drag mark was found on the other side, which continued to the east for several kilometers.",
        },
      ],
    },
    {
      atUtc: "2023-11-27T13:55:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Estonian prosecutor: the drag marks cross both damaged cables",
      citations: [DRAG_CROSSES_CABLES_CITATION],
    },
    {
      atUtc: "2024-04-22T06:00:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "The repaired pipeline carries gas again",
      citations: [{ sourceId: 12, quote: "Repairs on the Balticconnector gas pipeline have been completed. Gas started flowing through the pipeline again between Estonia and Finland on Monday morning." }],
    },
    {
      atUtc: "2024-08-12T11:31:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "China says its ship damaged the pipeline by accident in a storm; Estonia says the report is not evidence",
      citations: [
        {
          sourceId: 13,
          quote:
            "Claiming it was an accident, Beijing has admitted that the Chinese-owned and Hong Kong-flagged container ship Newnew Polar Bear damaged the Balticconnector, an undersea gas pipeline between Estonia and Finland, last October.",
        },
        {
          sourceId: 13,
          quote: 'In Estonia, a spokesperson for the Prosecutor\'s Office said that this document has not been sent to their office, and that it "can\'t be used as evidence in an Estonian criminal investigation."',
        },
      ],
    },
    {
      atUtc: "2025-05-08T06:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "The captain is charged and remanded in custody in Hong Kong",
      citations: [
        {
          sourceId: 14,
          quote:
            "The captain of the Hong Kong-flagged container ship accused of breaking the undersea gas pipeline between Finland and Estonia has been remanded in custody in Hong Kong, the South China Morning Post reports.",
        },
      ],
    },
    {
      atUtc: "2025-05-09T12:49:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Finnish police: the investigation shows the ship's anchor caused the damage",
      citations: [
        {
          sourceId: 5,
          quote:
            "The Balticconnector gas pipeline was damaged in the Gulf of Finland on 8 October 2023. On the basis of the criminal investigation, the damage was caused by the anchor of the vessel Newnew Polar Bear flying the flag of Hong Kong.",
        },
      ],
    },
    {
      atUtc: "2025-07-04T05:30:00Z",
      isTimeApproximate: false,
      kind: "court",
      title: "A preliminary hearing in Hong Kong cannot proceed: the captain has no lawyer",
      citations: [
        {
          sourceId: 15,
          quote: "The captain appeared for a preliminary hearing at 1:30 p.m. local time. However, the case could not proceed because it turned out the captain did not have a lawyer.",
        },
      ],
    },
    {
      atUtc: "2026-01-20T06:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "The plea is put off to 11 February so the defence can read the evidence",
      citations: [
        { sourceId: 16, quote: "The case was adjourned to February 11." },
        { sourceId: 16, quote: "Estonian police suspect the ship also damaged telecoms cables connecting Estonia to Finland and Sweden before hitting the pipeline." },
      ],
    },
    {
      atUtc: "2026-02-11T03:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "The captain pleads not guilty in Hong Kong; no verdict yet",
      citations: [
        {
          sourceId: 17,
          quote:
            "The Chinese captain of a Hong Kong-registered cargo ship pleaded not guilty on Wednesday to a charge of criminal damage, following allegations that his vessel damaged undersea cables in the Baltic Sea in October 2023.",
        },
        { sourceId: 17, quote: "The police retrieved a broken anchor from the seabed near the pipeline. Technical examinations showed it belonged to the container vessel." },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Police of Finland",
      title: "National Bureau of Investigation examines background of vessels sailing in the gas pipeline damage area",
      url: "https://poliisi.fi/en/-/national-bureau-of-investigation-examines-background-of-vessels-sailing-in-the-gas-pipeline-damage-area",
      publishedOn: "2023-10-17",
      archivedUrl: "https://web.archive.org/web/20231017184103/https://poliisi.fi/en/-/national-bureau-of-investigation-examines-background-of-vessels-sailing-in-the-gas-pipeline-damage-area",
    },
    {
      id: 2,
      publisher: "Police of Finland",
      title: "The investigation is now focused on the role of the vessel Newnew Polar Bear",
      url: "https://poliisi.fi/en/-/the-investigation-is-now-focused-on-the-role-of-the-vessel-newnew-polar-bear",
      publishedOn: "2023-10-20",
      archivedUrl: "https://web.archive.org/web/20231020172151/https://poliisi.fi/en/-/the-investigation-is-now-focused-on-the-role-of-the-vessel-newnew-polar-bear",
    },
    {
      id: 3,
      publisher: "Police of Finland",
      title: "National Bureau of Investigation has clarified technically the cause of gas pipeline damage",
      url: "https://poliisi.fi/en/-/national-bureau-of-investigation-has-clarified-technically-the-cause-of-gas-pipeline-damage",
      publishedOn: "2023-10-24",
      archivedUrl: "https://web.archive.org/web/20231024155122/https://poliisi.fi/en/-/national-bureau-of-investigation-has-clarified-technically-the-cause-of-gas-pipeline-damage",
    },
    {
      id: 4,
      publisher: "Police of Finland",
      title: "Investigations into the gas pipeline damage proceed",
      url: "https://poliisi.fi/en/-/investigations-into-the-gas-pipeline-damage-proceed",
      publishedOn: "2023-11-10",
      archivedUrl: "https://web.archive.org/web/20231110163838/https://poliisi.fi/en/-/investigations-into-the-gas-pipeline-damage-proceed",
    },
    {
      id: 5,
      publisher: "Police of Finland",
      title: "Cooperation in Balticconnector case to continue",
      url: "https://poliisi.fi/en/-/cooperation-in-balticconnector-case-to-continue",
      publishedOn: "2025-05-09",
      archivedUrl: "https://web.archive.org/web/20250509204242/https://poliisi.fi/en/-/cooperation-in-balticconnector-case-to-continue",
    },
    {
      id: 6,
      publisher: "Finnish Government",
      title: "Location of leak in Balticconnector gas pipeline identified in Finland's economic zone",
      url: "https://valtioneuvosto.fi/en/-/10616/location-of-leak-in-balticconnector-gas-pipeline-identified-in-finland-s-economic-zone",
      publishedOn: "2023-10-10",
      archivedUrl: "https://web.archive.org/web/20231011125319/https://valtioneuvosto.fi/en/-/10616/location-of-leak-in-balticconnector-gas-pipeline-identified-in-finland-s-economic-zone",
    },
    {
      id: 7,
      publisher: "NORSAR",
      title: "Seismic signal detected in the vicinity of the Balticconnector gas pipeline",
      url: "https://www.norsar.no/news/seismic-signal-detected-in-the-vicinity-of-the-baltic-connector-gas-pipeline",
      publishedOn: "2023-10-11",
      archivedUrl: "https://web.archive.org/web/20251012204324/https://www.norsar.no/news/seismic-signal-detected-in-the-vicinity-of-the-baltic-connector-gas-pipeline",
    },
    {
      id: 8,
      publisher: "Yle",
      title: "Video näyttää, kuinka kaasuputkirikosta epäilty alus ylittää Ruotsi-Viro-datakaapelin: vaurio tapahtui samoihin aikoihin",
      url: "https://yle.fi/a/74-20056160",
      publishedOn: "2023-10-20",
      archivedUrl: "https://web.archive.org/web/20231020143155/https://yle.fi/a/74-20056160",
    },
    {
      id: 9,
      publisher: "gCaptain (Reuters)",
      title: "Sweden Says Telecom Cable with Estonia Damaged",
      url: "https://gcaptain.com/sweden-says-telecom-cable-with-estonia-damaged/",
      publishedOn: "2023-10-17",
      archivedUrl: "https://web.archive.org/web/20231017161922/https://gcaptain.com/sweden-says-telecom-cable-with-estonia-damaged/",
    },
    {
      id: 10,
      publisher: "ERR News",
      title: "Cable between Estonia, Sweden damaged by 'external force or tampering'",
      url: "https://news.err.ee/1609142222/cable-between-estonia-sweden-damaged-by-external-force-or-tampering",
      publishedOn: "2023-10-23",
      archivedUrl: "https://web.archive.org/web/20231023173824/https://news.err.ee/1609142222/cable-between-estonia-sweden-damaged-by-external-force-or-tampering",
    },
    {
      id: 11,
      publisher: "ERR News",
      title: "Anchor that broke pipeline and cables could have been dragged for hundreds of kilometers",
      url: "https://news.err.ee/1609177669/anchor-that-broke-pipeline-and-cables-could-have-been-dragged-for-hundreds-of-kilometers",
      publishedOn: "2023-11-27",
      archivedUrl: "https://web.archive.org/web/20231128102207/https://news.err.ee/1609177669/anchor-that-broke-pipeline-and-cables-could-have-been-dragged-for-hundreds-of-kilometers",
    },
    {
      id: 12,
      publisher: "Yle News",
      title: "Baltic gas pipeline ruptured by Chinese ship back in service after €40m repair job",
      url: "https://yle.fi/a/74-20084948",
      publishedOn: "2024-04-22",
      archivedUrl: "https://web.archive.org/web/20240422132417/https://yle.fi/a/74-20084948",
    },
    {
      id: 13,
      publisher: "ERR News",
      title: "China admits container ship Newnew Polar Bear damaged undersea gas pipeline",
      url: "https://news.err.ee/1609422658/china-admits-container-ship-newnew-polar-bear-damaged-undersea-gas-pipeline",
      publishedOn: "2024-08-12",
      archivedUrl: "https://web.archive.org/web/20240812123900/https://news.err.ee/1609422658/china-admits-container-ship-newnew-polar-bear-damaged-undersea-gas-pipeline",
    },
    {
      id: 14,
      publisher: "ERR News",
      title: "Newnew Polar Bear captain arrested in Hong Kong over Baltic Sea cable break",
      url: "https://news.err.ee/1609689143/newnew-polar-bear-captain-arrested-in-hong-kong-over-baltic-sea-cable-break",
      publishedOn: "2025-05-09",
      archivedUrl: "https://web.archive.org/web/20250509114057/https://news.err.ee/1609689143/newnew-polar-bear-captain-arrested-in-hong-kong-over-baltic-sea-cable-break",
    },
    {
      id: 15,
      publisher: "ERR News",
      title: "Captain of ship that destroyed Balticconnector pipeline appears in Hong Kong court",
      url: "https://news.err.ee/1609738404/captain-of-ship-that-destroyed-balticconnector-pipeline-appears-in-hong-kong-court",
      publishedOn: "2025-07-05",
      archivedUrl: "https://web.archive.org/web/20250705114609/https://news.err.ee/1609738404/captain-of-ship-that-destroyed-balticconnector-pipeline-appears-in-hong-kong-court",
    },
    {
      id: 16,
      publisher: "The Standard (Reuters)",
      title: "Hong Kong court to call 18 witnesses over Baltic Sea undersea cable damage case",
      url: "https://www.thestandard.com.hk/news/article/322084/Hong-Kong-court-to-call-18-witnesses-over-Baltic-Sea-undersea-cable-damage-case",
      publishedOn: "2026-01-20",
      archivedUrl: "https://web.archive.org/web/20261017160301/https://www.thestandard.com.hk/news/article/322084/Hong-Kong-court-to-call-18-witnesses-over-Baltic-Sea-undersea-cable-damage-case",
    },
    {
      id: 17,
      publisher: "ERR News",
      title: "Ship captain pleads not guilty to Balticconnector damage charges",
      url: "https://news.err.ee/1609937861/ship-captain-pleads-not-guilty-to-balticconnector-damage-charges",
      publishedOn: "2026-02-11",
      archivedUrl: "https://web.archive.org/web/20260211062308/https://news.err.ee/1609937861/ship-captain-pleads-not-guilty-to-balticconnector-damage-charges",
    },
    {
      id: 18,
      publisher: "Yle News",
      title: "Finnish investigators confirm recovered anchor belongs to Chinese vessel",
      url: "https://yle.fi/a/74-20059680",
      publishedOn: "2023-11-10",
      archivedUrl: "https://web.archive.org/web/20231110171756/https://yle.fi/a/74-20059680",
    },
    {
      id: 19,
      publisher: "Danish Maritime Authority",
      title: "AIS archive file aisdk-2023-10.zip",
      url: "https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/2023/aisdk-2023-10.zip",
      publishedOn: "2025-07-21",
      archivedUrl: null,
    },
  ],
};
