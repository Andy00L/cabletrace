import type { CableCase } from "@/lib/cases/case-file";

// The Eagle S anchor drag, 25 December 2024. Sources, quotes and conversions: plan/research/eagle-s-reconstruction.md
// (source ids below keep that file's numbering). Finland used EET (UTC+2); every time here is UTC.
// No authority published a coordinate for the ship, the cuts or the drag trace, so every position is placed
// from a written description and says how in `placement`.

const ESTLINK_2_CITATION = {
  sourceId: 13,
  quote: "The electricity transmission cable has been cut in the sea area in Finland's exclusive economic zone about 55 km south of Loviisa.",
};
const ESTLINK_2_TRIP_CITATION = { sourceId: 15, quote: '"eventStart":"2024-12-25T10:26:00.0000000Z"' };
const ANCHOR_ON_SEABED_CITATION = {
  sourceId: 43,
  quote: "Muutamaa minuuttia myöhemmin se oli ylittänyt Estlink 2 -sähkökaapelin ja katkaissut sen pohjaan pudonneella ankkurillaan.",
  translation: "A few minutes later it had crossed the Estlink 2 cable and cut it with the anchor that had dropped to the bottom.",
};
const C_LION_PLACE_CITATION = {
  sourceId: 19,
  quote: "the location is in the Gulf of Finland, southeast of Porkkalanniemi, approximately 60 kilometers from Helsinki",
};
const C_LION_TIME_CITATION = {
  sourceId: 19,
  quote: "A fault was detected in Cinia Oy's C-Lion1 submarine cable, connecting Finland and Germany, on Wednesday, December 25, 2024, at 6:44 p.m.",
};
const RAISE_ANCHOR_CITATION = {
  sourceId: 42,
  quote: "Varttia vaille seitsemän illalla Merivartiosto ilmoitti epäilevänsä, että laiva raahaa jotakin merenpohjassa ja ankkuri on ulkona.",
  translation: "At a quarter to seven in the evening the Coast Guard said it suspected the ship was dragging something on the seabed and the anchor was out.",
};
const BOARDING_CITATION = { sourceId: 37, quote: "Markku Hassinen, deputy chief of the Finnish Border Guard, explained that at 12:28 a.m., authorities boarded the vessel Eagle S." };

export const EAGLE_S_2024: CableCase = {
  slug: "eagle-s-2024",
  title: "Eagle S anchor drag",
  subtitle: "Gulf of Finland, 25 December 2024",
  summary:
    "The tanker Eagle S crossed the gulf with an anchor on the seabed. Estlink 2 tripped at 12:26 local time, and by 18:43 five cables were broken along a drag trace investigators put at 90 to 100 km. No authority published the ship's positions, so the track below is placed from their written descriptions.",
  vessel: {
    name: "Eagle S",
    kind: "tanker",
    flag: "Cook Islands",
    type: "Oil tanker, 228.6 m",
    imo: "9329760",
    mmsi: "518998865",
    citations: [
      { sourceId: 1, quote: "Eagle S, a tanker registered in the Cook Islands" },
      { sourceId: 54, quote: "The vessel EAGLES (IMO 9329760, MMSI 518998865) is a Crude Oil Tanker built in 2006" },
      {
        sourceId: 11,
        quote: "Customs has established that the unleaded petrol and diesel carried by the tanker are classified as goods subject to sanctions against Russia",
      },
    ],
  },
  window: { startUtc: "2024-12-25T10:00:00Z", endUtc: "2024-12-25T23:00:00Z" },
  localTime: { place: "Helsinki", timeZone: "Europe/Helsinki" },
  seabedArea: "gulf-of-finland",
  track: [
    {
      atUtc: "2024-12-25T10:26:00Z",
      longitude: 26.20532,
      latitude: 59.93228,
      precision: "area",
      place: "Over Estlink 2, about 55 km south of Loviisa",
      placement: "Nearest point of the mapped Estlink 2 route (OpenStreetMap) to 55 km due south of Loviisa (OpenStreetMap, 60.45701 N, 26.22564 E); 3.2 km apart.",
      citations: [ESTLINK_2_CITATION, ESTLINK_2_TRIP_CITATION, ANCHOR_ON_SEABED_CITATION],
    },
    {
      atUtc: "2024-12-25T16:44:00Z",
      longitude: 24.78501,
      latitude: 59.84421,
      precision: "area",
      place: "Over C-Lion1, southeast of Porkkalanniemi",
      placement: "Point 60 km along the mapped C-Lion1 route (OpenStreetMap) from its Helsinki end, the reading of Cinia's distance that falls southeast of Porkkalanniemi.",
      citations: [C_LION_PLACE_CITATION, C_LION_TIME_CITATION],
    },
    {
      atUtc: "2024-12-25T22:28:00Z",
      longitude: 24.65554,
      latitude: 59.87142,
      precision: "area",
      place: "Southeast of the Porkkala cape, in Finnish territorial waters",
      placement: "17.5 km south-east of Porkkalanniemi (Wikipedia, 59.98333 N, 24.43333 E), the middle of the 15 to 20 km offshore that Yle reported on two days.",
      citations: [
        { sourceId: 13, quote: "The vessel is under the control of the Finnish authorities southeast of the Porkkala cape." },
        {
          sourceId: 29,
          quote: "The Finnish Border Guard's patrol vessel Turva escorted the tanker to waters some 20km off Porkkalaniemi, a peninsula on the Gulf of Finland, on Wednesday evening.",
        },
        BOARDING_CITATION,
      ],
    },
  ],
  // The Danish archive holds no Eagle S rows for 24 or 25 Dec 2024 (plan/research/historical-ais-coverage.md).
  recordedTrack: null,
  dragWindow: {
    startUtc: "2024-12-25T10:26:00Z",
    endUtc: "2024-12-25T16:45:00Z",
    citations: [
      ANCHOR_ON_SEABED_CITATION,
      RAISE_ANCHOR_CITATION,
      {
        sourceId: 10,
        quote: "On the basis of the forensic investigation, we suspect that the anchor came loose from the chain when the Finnish authorities asked the tanker's crew to lift the hanging anchor",
      },
    ],
  },
  cuts: [
    {
      cableName: "HVDC Estlink 2",
      label: "Estlink 2",
      owner: "Fingrid and Elering",
      atUtc: "2024-12-25T10:26:00Z",
      longitude: 26.20532,
      latitude: 59.93228,
      precision: "area",
      placement: "Nearest point of the mapped Estlink 2 route (OpenStreetMap) to 55 km due south of Loviisa; 3.2 km apart.",
      citations: [ESTLINK_2_CITATION, ESTLINK_2_TRIP_CITATION],
    },
    {
      cableName: "C-Lion 1",
      label: "C-Lion1",
      owner: "Cinia",
      atUtc: "2024-12-25T16:44:00Z",
      longitude: 24.78501,
      latitude: 59.84421,
      precision: "area",
      placement: "Point 60 km along the mapped C-Lion1 route (OpenStreetMap) from its Helsinki end. Cinia gives no time zone; EET is assumed, which matches the 18.43 of the investigation file.",
      citations: [C_LION_PLACE_CITATION, C_LION_TIME_CITATION],
    },
  ],
  events: [
    {
      atUtc: "2024-12-25T10:23:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "Enters Finland's exclusive economic zone",
      citations: [
        {
          sourceId: 43,
          quote: "Yli puoli tuntia ennen sitä, kello 12.23, Eagle S oli saapunut Suomen talousvyöhykkeelle.",
          translation: "Over half an hour before that, at 12.23, Eagle S had entered Finland's economic zone.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T10:26:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "Estlink 2 trips",
      citations: [ESTLINK_2_TRIP_CITATION, { sourceId: 31, quote: "The Estlink 2 cable connection was disrupted on Christmas Day at 12:26 pm, according to grid operator Fingrid." }],
    },
    {
      atUtc: "2024-12-25T10:59:00Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "The voyage data recorder starts recording again",
      citations: [
        {
          sourceId: 43,
          quote: "Kaapelirikkojen ajalta 25. joulukuuta 2024 järjestelmä oli tallentanut dataa vasta kello 12.59 alkaen.",
          translation: "For the cable breaks of 25 December 2024, the system had recorded data only from 12.59 on.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T11:05:00Z",
      isTimeApproximate: false,
      kind: "vessel",
      title: "The mate on watch reports low engine speed to the captain",
      citations: [
        {
          sourceId: 43,
          quote:
            "Pian tallennuksen käynnistymisen jälkeen, kello 13.05, aluksen navigoinnista vastannut perämies oli kertomansa mukaan tehnyt havainnon aluksen moottorin alhaisista kierroslukemista ja ottanut yhteyttä kapteeniin.",
          translation: "Soon after recording started, at 13.05, the mate in charge of navigation, by his own account, noticed low engine RPM and contacted the captain.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T11:50:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Turns back toward Russia for about half a kilometre",
      citations: [
        {
          sourceId: 31,
          quote: "The tanker turned back towards Russia at around 1:50 pm Finnish time and proceeded about half a kilometre backwards on its route.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T12:20:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Back on its westbound route",
      citations: [{ sourceId: 31, quote: "It then hooked back onto its original route at around 2:20 pm." }],
    },
    {
      atUtc: "2024-12-25T16:00:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "Crosses the Helsinki to Tallinn telecom cables: two Elisa cables severed, a CITIC Telecom cable damaged",
      citations: [
        {
          sourceId: 31,
          quote: "The tanker passed over the data cables between 6 and 7 pm on Wednesday evening, according to the MarineTraffic service, which tracks maritime traffic.",
        },
        {
          sourceId: 36,
          quote:
            "On Wednesday evening, the Consumer Protection and Technical Regulatory Authority (TTJA) received information that three undersea communication cables between Estonia and Finland were affected: two cables owned by the Elisa Group were severed and one cable belonging to CITIC Telecom was damaged.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T16:30:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "Border Guard patrol vessel Turva makes first contact",
      citations: [
        {
          sourceId: 31,
          quote: "The Border Guard patrol ship Turva contacted the Eagle S for the first time on Christmas Day at around 6:30 pm, Helsinki Police Chief Inspector Juha Hietala told Finnish News Agency STT.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T16:40:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Police take over the operation",
      citations: [{ sourceId: 11, quote: "Because of a criminal suspicion involved in the matter, the police took over leadership on 25 December at 18.40." }],
    },
    {
      atUtc: "2024-12-25T16:43:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "The last of the five damaged cables breaks",
      citations: [
        {
          sourceId: 43,
          quote: "Viidestä vaurioituneesta kaapelista viimeisin oli katkennut kello 18.43.",
          translation: "Of the five damaged cables, the last had broken at 18.43.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T16:44:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "Cinia detects a fault on C-Lion1",
      citations: [C_LION_TIME_CITATION],
    },
    {
      atUtc: "2024-12-25T16:45:00Z",
      isTimeApproximate: false,
      kind: "anchor",
      title: "The Coast Guard suspects dragging and asks the crew to raise the anchor",
      citations: [RAISE_ANCHOR_CITATION],
    },
    {
      atUtc: "2024-12-25T17:00:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "Only the chain comes up: the anchor is gone",
      citations: [
        {
          sourceId: 37,
          quote: "The crew was asked to lift the anchor, but only the anchor chain surfaced, raising suspicions of unusual activity involving the ship.",
        },
      ],
    },
    {
      atUtc: "2024-12-25T22:28:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Police and Border Guard board the tanker from helicopters",
      citations: [
        BOARDING_CITATION,
        { sourceId: 31, quote: "The oil tanker was in the possession of the authorities in Finnish territorial waters at around half past midnight on Thursday, Boxing Day." },
      ],
    },
  ],
  aftermath: [
    {
      atUtc: "2025-01-06T15:00:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "The anchor is raised from the seabed off Porkkala",
      citations: [
        { sourceId: 8, quote: "The anchor was raised to the surface after 17:00 yesterday." },
        { sourceId: 8, quote: "The location where the anchor was found is along the Eagle S's route, at the level of the Porkkala Peninsula." },
      ],
    },
    {
      atUtc: "2025-01-09T15:03:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Police put the drag trace at about 100 km",
      citations: [{ sourceId: 9, quote: "Underwater investigations have determined the length of the drag trace on the seabed to be approximately 100 kilometres." }],
    },
    {
      atUtc: "2025-08-11T09:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Charges brought against the master and two officers",
      citations: [
        {
          sourceId: 24,
          quote:
            "The Deputy Prosecutor General has brought charges of aggravated criminal mischief and aggravated interference with communications against the captain and first and second officers of the Cook Islands-registered tanker Eagle S.",
        },
      ],
    },
    {
      atUtc: "2025-10-03T09:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "District Court dismisses the case: Finnish criminal law does not apply",
      citations: [
        {
          sourceId: 27,
          quote:
            "Käräjäoikeus on tänään antamallaan tuomiolla jättänyt syytteen ja siihen perustuneet korvausvaatimukset tutkimatta Eagle S -alusta koskevassa asiassa, koska asiaan ei voitu soveltaa Suomen rikosoikeutta.",
          translation: "Today the District Court dismissed the charge and the damages claims based on it in the Eagle S case, because Finnish criminal law could not be applied.",
        },
      ],
    },
    {
      atUtc: "2026-08-27T09:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Court of Appeal overturns the dismissal and returns the case",
      citations: [
        {
          sourceId: 28,
          quote: "Helsingin hovioikeus on tänään antamallaan päätöksellä kumonnut Helsingin käräjäoikeuden tuomion ja palauttanut asian käräjäoikeuteen.",
          translation: "Today the Helsinki Court of Appeal overturned the Helsinki District Court's judgment and returned the case to the district court.",
        },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Police of Finland",
      title: "Police investigating incidents in the Gulf of Finland in cooperation with other authorities",
      url: "https://poliisi.fi/en/-/police-investigating-incidents-in-the-gulf-of-finland-in-cooperation-with-other-authorities",
      publishedOn: "2024-12-26",
      archivedUrl: "https://web.archive.org/web/20241226152457/https://poliisi.fi/en/-/police-investigating-incidents-in-the-gulf-of-finland-in-cooperation-with-other-authorities",
    },
    {
      id: 8,
      publisher: "Police of Finland",
      title: "Anchor allegedly involved in cable ruptures on Christmas day recovered in Gulf of Finland",
      url: "https://poliisi.fi/en/-/anchor-allegedly-involved-in-cable-ruptures-on-christmas-day-recovered-in-gulf-of-finland",
      publishedOn: "2025-01-07",
      archivedUrl: "https://web.archive.org/web/20250107153848/https://poliisi.fi/en/-/anchor-allegedly-involved-in-cable-ruptures-on-christmas-day-recovered-in-gulf-of-finland",
    },
    {
      id: 9,
      publisher: "Police of Finland",
      title: "Forensic analysis of the anchor hoisted from Gulf of Finland started",
      url: "https://poliisi.fi/en/-/forensic-analysis-of-the-anchor-hoisted-from-gulf-of-finland-started",
      publishedOn: "2025-01-09",
      archivedUrl: "https://web.archive.org/web/20250111065638/https://poliisi.fi/en/-/forensic-analysis-of-the-anchor-hoisted-from-gulf-of-finland-started",
    },
    {
      id: 10,
      publisher: "Police of Finland",
      title: "Active early phase of cable investigation to be completed",
      url: "https://poliisi.fi/en/-/active-early-phase-of-cable-investigation-to-be-completed",
      publishedOn: "2025-01-22",
      archivedUrl: "https://web.archive.org/web/20250122145105/https://poliisi.fi/en/-/active-early-phase-of-cable-investigation-to-be-completed",
    },
    {
      id: 11,
      publisher: "Police of Finland",
      title: "Eagle S tanker to move to international waters under Border Guard's control",
      url: "https://poliisi.fi/en/-/eagle-s-tanker-to-move-to-international-waters-under-border-guard-s-control",
      publishedOn: "2025-03-02",
      archivedUrl: "https://web.archive.org/web/20250310215651/https://poliisi.fi/en/-/eagle-s-tanker-to-move-to-international-waters-under-border-guard-s-control",
    },
    {
      id: 13,
      publisher: "Finnish Border Guard",
      title: "Estlink 2 electricity transmission cable damaged in the Baltic Sea on 25 Dec 2024",
      url: "https://raja.fi/en/-/estlink-2-electricity-transmission-cable-damaged-in-the-baltic-sea-on-25-dec-2024",
      publishedOn: "2024-12-26",
      archivedUrl: "https://web.archive.org/web/20250103003037/https://raja.fi/en/-/estlink-2-electricity-transmission-cable-damaged-in-the-baltic-sea-on-25-dec-2024",
    },
    {
      id: 15,
      publisher: "Nord Pool market message, published by Fingrid",
      title: "Estlink 2 unavailability",
      url: "https://umm.nordpoolgroup.com/#/messages/79210ee1-3395-4f75-a972-7b03888b107a/5",
      publishedOn: "2024-12-25",
      archivedUrl: "https://web.archive.org/web/20170201134931/https://umm.nordpoolgroup.com/",
    },
    {
      id: 19,
      publisher: "Cinia",
      title: "Fault detected in Cinia C-Lion1 submarine cable",
      url: "https://www.cinia.fi/en/news/fault-detected-in-cinia-c-lion1-submarine-cable",
      publishedOn: "2024-12-26",
      archivedUrl: "https://web.archive.org/web/20241226125741/https://www.cinia.fi/en/news/fault-detected-in-cinia-c-lion1-submarine-cable",
    },
    {
      id: 24,
      publisher: "National Prosecution Authority of Finland",
      title: "Charges have been brought in the case concerning the cutting of submarine cables in the Gulf of Finland during Christmas 2024",
      url: "https://www.syyttajalaitos.fi/en/news/news-archive/charges-have-been-brought-in-the-case-concerning-the-cutting-of-submarine-cables-in-the-gulf-of-finland-during-christmas-2024/",
      publishedOn: "2025-08-11",
      archivedUrl: null,
    },
    {
      id: 27,
      publisher: "Helsinki District Court",
      title: "Käräjäoikeuden ratkaisu EagleS -alukseen liittyvässä rikosasiassa",
      url: "https://www.tuomioistuimet.fi/ajankohtaista/tiedotteet/karajaoikeuden-ratkaisu-eagles-alukseen-liittyvassa-rikosasiassa/",
      publishedOn: "2025-10-03",
      archivedUrl: "https://web.archive.org/web/20260518220028/https://www.tuomioistuimet.fi/ajankohtaista/tiedotteet/karajaoikeuden-ratkaisu-eagles-alukseen-liittyvassa-rikosasiassa/",
    },
    {
      id: 28,
      publisher: "Helsinki Court of Appeal",
      title: "Tiedote hovioikeuden päätöksestä ns. Eagle S -aluksen asiassa (R 16/2025/2572)",
      url: "https://www.tuomioistuimet.fi/ajankohtaista/tiedotteet/tiedote-hovioikeuden-paatoksesta-ns-eagle-s-aluksen-asiassa-r-16-2025-2572/",
      publishedOn: "2026-08-27",
      archivedUrl: "https://web.archive.org/web/20260914042203/https://www.tuomioistuimet.fi/ajankohtaista/tiedotteet/tiedote-hovioikeuden-paatoksesta-ns-eagle-s-aluksen-asiassa-r-16-2025-2572/",
    },
    {
      id: 29,
      publisher: "Yle News",
      title: "Estlink cable disruption: Finnish Border Guard detains tanker linked to Russia's 'dark fleet'",
      url: "https://yle.fi/a/74-20133516",
      publishedOn: "2024-12-26",
      archivedUrl: "https://web.archive.org/web/20241226112207/https://yle.fi/a/74-20133516",
    },
    { id: 31, publisher: "Yle News", title: "Maps reveal the path of the Eagle S on Christmas Day", url: "https://yle.fi/a/74-20133606", publishedOn: "2024-12-27", archivedUrl: "https://web.archive.org/web/20241227124616/https://yle.fi/a/74-20133606" },
    {
      id: 36,
      publisher: "ERR News",
      title: "Communications cables between Estonia and Finland disrupted, services online",
      url: "https://news.err.ee/1609560718/communications-cables-between-estonia-and-finland-disrupted-services-online",
      publishedOn: "2024-12-26",
      archivedUrl: "https://web.archive.org/web/20241226114700/https://news.err.ee/1609560718/communications-cables-between-estonia-and-finland-disrupted-services-online",
    },
    {
      id: 37,
      publisher: "ERR News",
      title: "Finnish police: Ship at the site of EstLink 2's breakage missing anchor",
      url: "https://news.err.ee/1609560763/finnish-police-ship-at-the-site-of-estlink-2-s-breakage-missing-anchor",
      publishedOn: "2024-12-26",
      archivedUrl: "https://web.archive.org/web/20241226144908/https://news.err.ee/1609560763/finnish-police-ship-at-the-site-of-estlink-2-s-breakage-missing-anchor",
    },
    {
      id: 42,
      publisher: "Yle",
      title: "Poliisitutkinta: Eagle S -tankkerin miehistö meni paniikkiin, kun kuuli ankkurin putoamisesta mereen",
      url: "https://yle.fi/a/74-20178527",
      publishedOn: "2025-08-25",
      archivedUrl: "https://web.archive.org/web/20250825132401/https://yle.fi/a/74-20178527",
    },
    {
      id: 43,
      publisher: "Yle",
      title: "Eagle S -tutkinnasta hätkähdyttävä tieto: Musta laatikko oli pois päältä, kun laiva alkoi katkoa kaapeleita",
      url: "https://yle.fi/a/74-20179391",
      publishedOn: "2025-08-26",
      archivedUrl: "https://web.archive.org/web/20250826115354/https://yle.fi/a/74-20179391",
    },
    { id: 54, publisher: "VesselFinder", title: "EAGLES, Crude Oil Tanker, IMO 9329760", url: "https://www.vesselfinder.com/vessels/details/9329760", publishedOn: "2026-10-17", archivedUrl: null },
  ],
};
