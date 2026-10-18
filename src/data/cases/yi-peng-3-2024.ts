import type { CableCase } from "@/lib/cases/case-file";
import { YI_PENG_3_AIS_FIXES } from "@/data/cases/yi-peng-3-2024-ais";

// The Yi Peng 3 anchor drag, 17 and 18 November 2024. Sources, quotes, conflicts and the arithmetic behind each
// placement: plan/research/yi-peng-3-reconstruction.md (source ids below keep that file's numbering). Every time
// here is UTC; Lithuania and Finland used EET (UTC+2), Sweden CET (UTC+1).
// The ship's own AIS survives only from 06:01:44 UTC on 18 November (the Danish archive). Earlier positions
// are placed from written descriptions and say how in `placement`.

const BCS_DOWN_CITATION = {
  sourceId: 2,
  quote: "The cable went out of service at about 0800 GMT on Sunday, according to Lithuania's Telia Lietuva, part of Sweden's Telia Company group.",
};
const BCS_LOCAL_TIME_CITATION = {
  sourceId: 1,
  quote:
    "On Sunday, November 17 2024, the BCS East-West Interlink submarine cable connecting Sventoji, Lithuania and Katthammarsvik, Sweden was reportedly damaged around 10:00 local (Lithuania) time (08:00 UTC).",
};
const BCS_PASSAGE_CITATION = {
  sourceId: 4,
  quote: "Uit dezelfde AIS-gegevens zou blijken dat het schip zondagochtend de kabel ten oosten van Gotland passeerde.",
  translation: "The same AIS data would show that the ship passed the cable east of Gotland on Sunday morning.",
};
const BCS_FOUND_CITATION = {
  sourceId: 2,
  quote: "The failure of the submarine cable between Sweden and Lithuania was discovered on Sunday, November 17, around 10 a.m. Finnish time.",
};
const BCS_BEFORE_TEN_CITATION = {
  sourceId: 2,
  quote: "The Yi Peng 3 vessel moved near the cable a little before ten o'clock, according to the data of the Marinetraffic service, which monitors ship traffic.",
};
const TRAVEL_BETWEEN_BREAKS_CITATION = {
  sourceId: 5,
  quote: "According to the investigators, Yi Peng 3 severed the second cable linking Germany and Finland the next day at around 3:00 after travelling about 178 kilometres.",
};
const C_LION_PLACE_CITATION = {
  sourceId: 3,
  quote: "The location of the cable cut is in the Baltic Sea, in the Swedish Exclusive Economic Zone, east of the southern tip of Öland, about 700 km from Helsinki.",
};
const C_LION_TIME_CITATION = { sourceId: 2, quote: "Cinia said the C-Lion1 submarine cable was interrupted after 4 am (GMT 0200) on Monday 18th November, 2024." };
const C_LION_UTC_CITATION = { sourceId: 1, quote: "Cinia, the telecommunications company that owns the cable, said that the cable stopped working at about 02:00 UTC." };
const C_LION_NEAR_CITATION = {
  sourceId: 2,
  quote: "The same Chinese vessel passed near the C-Lion1 submarine cable running between Germany and Finland on Monday morning, November 18 at 4:04 am.",
};
const C_LION_PASSAGE_CITATION = {
  sourceId: 4,
  quote: "Uit analyse van het Duitse medium NDR-WDR blijkt dat het Chinese schip maandagochtend de kabel tussen Finland en Duitsland is gepasseerd.",
  translation: "An analysis by the German outlet NDR-WDR shows that the Chinese ship passed the cable between Finland and Germany on Monday morning.",
};
const FIRST_FIX_CITATION = {
  sourceId: 10,
  quote: "18/11/2024 06:01:44,Class A,414270000,55.760593,16.266613,Under way using engine,0.0,7.3,254.7,253",
};
const STOP_CITATION = {
  sourceId: 10,
  quote: "18/11/2024 08:23:54,Class A,414270000,55.689648,15.794630,Under way using engine,0.0,0.9,247.1,255",
};
const ANCHOR_DAYS_CITATION = {
  sourceId: 7,
  quote: "Undersökningen visar att Yi Peng 3 släpade babords ankare efter sig i ett och ett halvt dygn, i 180 sjömil.",
  translation: "The investigation shows that Yi Peng 3 dragged its port anchor behind it for a day and a half, over 180 nautical miles.",
};
const RAISED_ANCHOR_CITATION = { sourceId: 5, quote: "Shortly afterwards, the ship started zigzagging, raised anchor, and continued." };

export const YI_PENG_3_2024: CableCase = {
  slug: "yi-peng-3-2024",
  title: "Yi Peng 3 anchor drag",
  subtitle: "Baltic Proper, 17 and 18 November 2024",
  summary:
    "Yi Peng 3 was sailing from Ust-Luga to Port Said when BCS East-West Interlink went down at about 08:00 UTC on 17 November and C-Lion1 at about 02:00 UTC on 18 November. Its own AIS survives only from 06:01 that morning; run backward at the recorded course and speed, it crosses C-Lion1 at 02:15. The earlier track is placed from statements.",
  vessel: {
    name: "Yi Peng 3",
    kind: "bulk-carrier",
    flag: "China",
    type: "Bulk carrier, 224 m",
    lengthMetres: 224,
    imo: "9224984",
    mmsi: "414270000",
    citations: [
      {
        sourceId: 4,
        quote:
          "De Yi Peng 3, een cargoschip dat onder Chinese vlag vaart, was van de Russische haven Oest-Loega op weg naar Port Said in Egypte toen het zowel de Zweeds-Litouwse als Fins-Duitse kabels in de Oostzee passeerde.",
        translation:
          "Yi Peng 3, a cargo ship sailing under the Chinese flag, was on its way from the Russian port of Ust-Luga to Port Said in Egypt when it passed both the Swedish-Lithuanian and the Finnish-German cables in the Baltic Sea.",
      },
      {
        sourceId: 10,
        quote: "18/11/2024 07:27:56,Class A,414270000,55.714953,15.974378,Under way using engine,0.0,7.3,257.0,257,9224984,BPME8,YI PENG 3,Cargo,,32,224",
      },
      {
        sourceId: 2,
        quote: "Chinese bulk carrier Yi Peng 3 was anchored in the Kattegat strait between Denmark and Sweden on Wednesday, with a Danish navy patrol ship at anchor nearby, MarineTraffic vessel tracking data showed.",
      },
    ],
  },
  window: { startUtc: "2024-11-17T07:45:00Z", endUtc: "2024-11-18T11:00:00Z" },
  localTime: { place: "Stockholm", timeZone: "Europe/Stockholm" },
  seabedArea: "baltic-proper",
  track: [
    {
      atUtc: "2024-11-17T07:55:00Z",
      longitude: 19.51567,
      latitude: 56.90991,
      precision: "area",
      place: "Over BCS East-West Interlink, east of Gotland",
      placement:
        "No source gives the spot. The point of the mapped BCS route (OpenStreetMap) nearest the C-Lion1 cut, 68 km from the Katthammarsvik landing; the two cuts end up 190 km apart, against the about 178 km of travel between the breaks in the WSJ's account. The time is HS's 'a little before ten', Finnish time.",
      citations: [BCS_PASSAGE_CITATION, BCS_BEFORE_TEN_CITATION, TRAVEL_BETWEEN_BREAKS_CITATION],
    },
    {
      atUtc: "2024-11-18T02:04:00Z",
      longitude: 17.05571,
      latitude: 55.88203,
      precision: "area",
      place: "Over C-Lion1, east of Öland's southern tip",
      placement:
        "Where the first recorded AIS course (254.7 degrees, 7.3 knots at 06:01:44), run backward 51 km, meets the mapped C-Lion1 route. At that speed the ship crosses at 02:15, 11 minutes after the 4:04 Finnish time HS gives; the point is 54 km from Öland's southern tip and 748 km along the route from Helsinki (665 km in a straight line), against Cinia's 'about 700 km'.",
      citations: [C_LION_PLACE_CITATION, C_LION_NEAR_CITATION, C_LION_PASSAGE_CITATION, FIRST_FIX_CITATION],
    },
  ],
  recordedTrack: {
    selection:
      "Rows with MMSI 414270000 in the Danish Maritime Authority file for 18 November, 06:00 to 11:00, the first of every 2 minutes. The archive does not state a time zone; read as UTC, the backward course meets C-Lion1 11 minutes after the passage time HS gives, read as Danish time 49 minutes before it.",
    citations: [FIRST_FIX_CITATION],
    fixes: YI_PENG_3_AIS_FIXES,
  },
  dragWindow: {
    startUtc: "2024-11-17T07:45:00Z",
    endUtc: "2024-11-18T08:24:00Z",
    citations: [ANCHOR_DAYS_CITATION, { sourceId: 8, quote: "Investigators pointed out that the vessel dragged its port anchor for 1.5 days or approximately 180 nautical miles." }, RAISED_ANCHOR_CITATION, STOP_CITATION],
  },
  cuts: [
    {
      cableName: "C-Lion 1",
      label: "C-Lion1",
      owner: "Cinia",
      atUtc: "2024-11-18T02:00:00Z",
      longitude: 17.05571,
      latitude: 55.88203,
      precision: "area",
      placement: "Where the first recorded AIS course, run backward, meets the mapped C-Lion1 route: east of Öland's southern tip, 748 km along the route from Helsinki.",
      citations: [C_LION_PLACE_CITATION, C_LION_TIME_CITATION, C_LION_UTC_CITATION],
    },
    {
      cableName: "BCS East-West Interlink",
      label: "BCS East-West",
      owner: "Arelion",
      atUtc: "2024-11-17T08:00:00Z",
      longitude: 19.51567,
      latitude: 56.90991,
      precision: "area",
      placement: "No source gives the spot: the point of the mapped BCS route nearest the C-Lion1 cut.",
      citations: [
        BCS_DOWN_CITATION,
        BCS_FOUND_CITATION,
        BCS_LOCAL_TIME_CITATION,
        { sourceId: 2, quote: "The BCS East-West Interlink spans 218km (135-mile) linking between Lithuania with Sweden's Gotland island, operated by Arelion (formerly Telia)." },
      ],
    },
  ],
  events: [
    {
      atUtc: "2024-11-17T07:55:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "AIS puts Yi Peng 3 over the BCS cable east of Gotland",
      citations: [BCS_PASSAGE_CITATION, BCS_BEFORE_TEN_CITATION],
    },
    {
      atUtc: "2024-11-17T08:00:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "BCS East-West Interlink goes out of service",
      citations: [BCS_DOWN_CITATION, BCS_FOUND_CITATION, BCS_LOCAL_TIME_CITATION],
    },
    {
      atUtc: "2024-11-18T02:00:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "C-Lion1 stops carrying traffic",
      citations: [C_LION_TIME_CITATION, C_LION_UTC_CITATION],
    },
    {
      atUtc: "2024-11-18T02:04:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Yi Peng 3 passes near C-Lion1",
      citations: [C_LION_NEAR_CITATION, C_LION_PASSAGE_CITATION],
    },
    {
      atUtc: "2024-11-18T06:01:44Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "First position in the Danish AIS archive: 7.3 knots, heading west-south-west",
      citations: [FIRST_FIX_CITATION],
    },
    {
      atUtc: "2024-11-18T08:24:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Slows from 7.6 knots to under 1 and holds position for 75 minutes",
      citations: [
        { sourceId: 10, quote: "18/11/2024 08:00:04,Class A,414270000,55.698890,15.858992,Under way using engine,0.0,7.6,257.1,257" },
        STOP_CITATION,
        RAISED_ANCHOR_CITATION,
      ],
    },
    {
      atUtc: "2024-11-18T09:38:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Under way again, at 10.1 knots by 10:00: 2.5 knots faster than before the stop",
      citations: [
        { sourceId: 10, quote: "18/11/2024 09:38:25,Class A,414270000,55.687758,15.789237,Under way using engine,0.0,5.0,250.5,251" },
        { sourceId: 10, quote: "18/11/2024 10:00:04,Class A,414270000,55.669277,15.708470,Under way using engine,0.0,10.1,246.0,245" },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2024-11-19T10:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Cinia asks Finland's National Bureau of Investigation to investigate",
      citations: [{ sourceId: 3, quote: "Cinia has submitted a request for investigation to the National Bureau of Investigation (NBI) on 19 November 2024." }],
    },
    {
      atUtc: "2024-11-20T12:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "Yi Peng 3 lies at anchor in the Kattegat, a Danish navy patrol ship beside it",
      citations: [
        {
          sourceId: 2,
          quote: "Chinese bulk carrier Yi Peng 3 was anchored in the Kattegat strait between Denmark and Sweden on Wednesday, with a Danish navy patrol ship at anchor nearby, MarineTraffic vessel tracking data showed.",
        },
      ],
    },
    {
      atUtc: "2024-11-25T05:00:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "Repair ship Cable Vigilance starts work at the C-Lion1 fault",
      citations: [
        {
          sourceId: 3,
          quote:
            "The repair vessel Cable Vigilance left Calais, France, on Thursday 21 November at 9 p.m. (EET) and it arrived at the fault site early on Monday morning 25 November and started the repair work.",
        },
      ],
    },
    {
      atUtc: "2024-11-28T12:00:00Z",
      isTimeApproximate: true,
      kind: "repair",
      title: "BCS East-West Interlink repaired and back in service",
      citations: [{ sourceId: 2, quote: "The BCS East-West Interlink between Lithuania and Sweden's Gotland island was repaired and restored services on Thursday, November 28." }],
    },
    {
      atUtc: "2024-11-28T19:00:00Z",
      isTimeApproximate: false,
      kind: "repair",
      title: "C-Lion1 repaired and back online",
      citations: [
        {
          sourceId: 2,
          quote:
            "The break in Cinia's C-Lion1 submarine cable has been repaired on Thursday 28th of November 2024 at 9 pm (EET), and the direct submarine cable connection between Finland and Germany is back online and fully operational.",
        },
      ],
    },
    {
      atUtc: "2024-12-19T10:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Investigators board Yi Peng 3 under Chinese lead; SHK takes part, Swedish police observe",
      citations: [
        {
          sourceId: 6,
          quote: "Fartyget Yi Peng 3 har efter sin passage ut ur Östersjön ankrat på internationellt vatten.",
          translation: "After its passage out of the Baltic Sea, the ship Yi Peng 3 has anchored in international waters.",
        },
        {
          sourceId: 6,
          quote: "Dessutom deltar representanter för Polismyndigheten, liksom rättsvårdande myndigheter i andra berörda stater, som observatörer.",
          translation: "Representatives of the Swedish Police Authority, and of law enforcement in other affected states, also take part as observers.",
        },
      ],
    },
    {
      atUtc: "2024-12-21T13:30:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Yi Peng 3 weighs anchor in the Kattegat and heads north",
      citations: [
        {
          sourceId: 9,
          quote: "Yi Peng 3 lättade ankar omkring 14.30 på lördagen, och rör sig just nu norrut i Kattegatt.",
          translation: "Yi Peng 3 weighed anchor at about 14.30 on Saturday and is now moving north in the Kattegat.",
        },
      ],
    },
    {
      atUtc: "2025-04-15T08:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "SHK cannot say whether the damage was deliberate; the port anchor dragged for a day and a half",
      citations: [
        {
          sourceId: 8,
          quote: "cannot be determined with certainty whether a Chinese ship intentionally damaged data cables in the Baltic Sea in November 2024.",
        },
        ANCHOR_DAYS_CITATION,
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Cloudflare",
      title: "Resilient Internet connectivity in Europe mitigates impact from multiple cable cuts",
      url: "https://blog.cloudflare.com/resilient-internet-connectivity-baltic-cable-cuts/",
      publishedOn: "2024-11-20",
      archivedUrl: "https://web.archive.org/web/20241120213442/https://blog.cloudflare.com/resilient-internet-connectivity-baltic-cable-cuts/",
    },
    {
      id: 2,
      publisher: "Submarine Networks",
      title: "C-Lion1 breaks in the Baltic Sea, no evidence of intentional damage",
      url: "https://www.submarinenetworks.com/en/systems/intra-europe/sea-lion/c-lion1-breaks-in-the-baltic-sea,-no-evidence-of-intentional-damage",
      publishedOn: "2024-11-19",
      archivedUrl: "https://web.archive.org/web/20241119212205/https://www.submarinenetworks.com/en/systems/intra-europe/sea-lion/c-lion1-breaks-in-the-baltic-sea,-no-evidence-of-intentional-damage",
    },
    {
      id: 3,
      publisher: "Cinia",
      title: "A fault in the Cinia C-Lion1 submarine cable between Finland and Germany",
      url: "https://cinia.fi/en/news/a-fault-in-the-cinia-c-lion1-submarine-cable-between-finland-and-germany",
      publishedOn: "2024-11-18",
      archivedUrl: "https://web.archive.org/web/20241118104026/https://www.cinia.fi/en/news/a-fault-in-the-cinia-c-lion1-submarine-cable-between-finland-and-germany",
    },
    {
      id: 4,
      publisher: "VRT NWS",
      title: "Waarom Chinees vrachtschip plots in het vizier komt als verdachte van beschadiging kabels in Oostzee",
      url: "https://www.vrt.be/vrtnws/nl/2024/11/20/chinees-cargoschip-gespot-in-de-buurt-van-beschadigde-kabels-oos/",
      publishedOn: "2024-11-20",
      archivedUrl: "https://web.archive.org/web/20241120162624/https://www.vrt.be/vrtnws/nl/2024/11/20/chinees-cargoschip-gespot-in-de-buurt-van-beschadigde-kabels-oos/",
    },
    {
      id: 5,
      publisher: "LRT",
      title: "Chinese ship suspected of deliberately cutting cables in Baltic Sea - media",
      url: "https://www.lrt.lt/en/news-in-english/19/2426033/chinese-ship-suspected-of-deliberately-cutting-cables-in-baltic-sea-media",
      publishedOn: "2024-11-28",
      archivedUrl: "https://web.archive.org/web/20241128204902/https://www.lrt.lt/en/news-in-english/19/2426033/chinese-ship-suspected-of-deliberately-cutting-cables-in-baltic-sea-media",
    },
    {
      id: 6,
      publisher: "Statens haverikommission (SHK)",
      title: "Pressmeddelande: Undersökningar på det kinesiska fartyget Yi Peng 3",
      url: "https://www.shk.se/aktuellt/pressmeddelanden/2024-12-19-pressmeddelande-undersokningar-pa-det-kinesiska-fartyget-yi-peng-3",
      publishedOn: "2024-12-19",
      archivedUrl: "https://web.archive.org/web/20260418210453/https://shk.se/aktuellt/pressmeddelanden/2024-12-19-pressmeddelande-undersokningar-pa-det-kinesiska-fartyget-yi-peng-3",
    },
    {
      id: 7,
      publisher: "SVT Nyheter",
      title: "Inga bevis för avsiktligt kabelbrott i Östersjön",
      url: "https://www.svt.se/nyheter/inrikes/inga-bevis-for-avsiktligt-kabelbrott-i-ostersjon",
      publishedOn: "2025-04-15",
      archivedUrl: "https://web.archive.org/web/20250415093825/https://www.svt.se/nyheter/inrikes/inga-bevis-for-avsiktligt-kabelbrott-i-ostersjon",
    },
    {
      id: 8,
      publisher: "The Maritime Executive",
      title: "Swedish Report Fails to Find Evidence of Sabotage by Chinese Bulker",
      url: "https://maritime-executive.com/article/swedish-report-fails-to-find-evidence-of-sabotage-by-chinese-bulker",
      publishedOn: "2025-04-15",
      archivedUrl: "https://web.archive.org/web/20250415172418/https://maritime-executive.com/article/swedish-report-fails-to-find-evidence-of-sabotage-by-chinese-bulker",
    },
    {
      id: 9,
      publisher: "SVT Nyheter",
      title: "Kinesiska fartyget har börjat röra på sig - sätter kurs mot Egypten",
      url: "https://www.svt.se/nyheter/inrikes/kinesiska-fartyget-har-borjat-rora-pa-sig",
      publishedOn: "2024-12-21",
      archivedUrl: "https://web.archive.org/web/20241222084007/https://www.svt.se/nyheter/inrikes/kinesiska-fartyget-har-borjat-rora-pa-sig",
    },
    {
      id: 10,
      publisher: "Danish Maritime Authority",
      title: "AIS data archive, aisdk-2024-11-18.zip",
      // The archive moved its 2024 files into a year folder; the old address answers 404 (checked 17 Oct 2026).
      url: "https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/2024/aisdk-2024-11-18.zip",
      publishedOn: "2025-07-21",
      archivedUrl: null,
    },
  ],
};
