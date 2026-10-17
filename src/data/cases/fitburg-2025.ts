import type { CableCase } from "@/lib/cases/case-file";

// The Fitburg anchor drag, 30 and 31 December 2025. Sources, quotes, conflicts and the arithmetic behind each
// placement: plan/research/cases/fitburg-2025.md (source ids below keep that file's numbering). Finland used EET
// (UTC+2) in winter and EEST (UTC+3) in summer; every time here is UTC.
// No authority published a coordinate. The route is read off the MarineTraffic map Yle published at 13:48 on
// 31 December [13]: the red line's centre, georeferenced with a Web Mercator fit to the map's Helsinki and Hanko
// markers and Suursaari island (Nominatim; residuals under 0.7 km). Times on that route come from statements.

const ELISA_FAULT_CITATION = {
  sourceId: 11,
  quote: "4.53: Tapahtumat alkoivat vyöryä, kun Elisa kertoi viranomaisille tietoliikennekaapelinsa vaurioituneen.",
  translation: "4.53: Events began to roll when Elisa told the authorities its telecommunications cable had been damaged.",
};
const FAULT_TIMES_CITATION = {
  sourceId: 16,
  quote: "Finnish authorities first became aware of a fault in an Elisa cable at 04:53 on New Year's Eve. A second fault involving an Arelion cable was reported shortly afterwards.",
};
const DAMAGE_IN_ESTONIAN_EEZ_CITATION = {
  sourceId: 7,
  quote:
    "On 31 December 2025, two subsea telecommunications cables owned by Elisa Oyj and Arelion Finland Oy and running between Finland and Estonia were damaged within Estonia's exclusive economic zone.",
};
const MOVING_INTO_FINNISH_EEZ_CITATION = {
  sourceId: 15,
  quote: 'Speaking about the Elisa cable, the ministry said: "At the time of the damage, a vessel was moving from the Estonian EEZ into the Finnish EEZ and was subsequently detained by the Finnish Border Guard."',
};
const CABLES_CLOSE_CITATION = { sourceId: 15, quote: "Grünberg said these cables are located fairly close to each other, and the damage to both occurred around the same time." };
const ROUTE_MAP_CITATION = {
  sourceId: 13,
  quote:
    "Fitburg-niminen alus lähti liikkeelle Venäjältä Pietarista tiistaina. Viranomaiset pysäyttivät aluksen keskiviikkona ja se on otettu haltuun Porkkalan edustalla. Aluksen reitti selvisi merenkulkua seuraavan Marinetraffic-sivustolta.",
  translation:
    "The vessel named Fitburg set off from St Petersburg, Russia, on Tuesday. The authorities stopped it on Wednesday and it has been taken into possession off Porkkala. Its route comes from the MarineTraffic ship-tracking site.",
};
const SUURSAARI_CITATION = {
  sourceId: 12,
  quote: "Alus ohitti Venäjälle kuuluvan Suursaaren tiistai-iltana kello yhdeksän aikoihin, ja jatkoi matkaansa yön yli kohti länttä.",
  translation: "The ship passed Suursaari, which belongs to Russia, at around nine on Tuesday evening and continued west through the night.",
};
const STOPPED_CITATION = {
  sourceId: 12,
  quote: "Hieman ennen aamukahdeksaa keskiviikkona alus kuitenkin ilmeisesti pysäytettiin sen kulkiessa keskellä Suomenlahtea Inkoon eteläpuolella.",
  translation: "Shortly before eight on Wednesday morning, however, the ship was apparently stopped while sailing in the middle of the Gulf of Finland south of Inkoo.",
};
const RUSSIAN_BORDER_CITATION = {
  sourceId: 17,
  quote: "Sen voimme varmuudella sanoa, että tämä alus on raahannut ankkuria perässään Venäjän rajalta lähtien 130 kilometriä rikkoen tullessaan kaapelit.",
  translation: "What we can say with certainty is that this ship dragged the anchor behind it from the Russian border for 130 kilometres, breaking the cables as it came.",
};
const TRACE_EXTENT_CITATION = {
  sourceId: 17,
  quote: "Raahausjälki sopii aluksen ankkuritukin muotoon ja ulottuu ankkurin nostohetkestä Suomenlahdella Venäjän aluevesille asti.",
  translation: "The drag mark fits the shape of the ship's anchor shank and runs from where the anchor was raised in the Gulf of Finland all the way to Russian territorial waters.",
};
const TREATY_LINE_CITATION = {
  sourceId: 22,
  quote: '[26.33943333,59.99491667]]]},"geometry_name":"the_geom","properties":{"line_id":1905,"line_name":"Estonia - Russia","line_type":"Treaty"',
};
const ESTONIA_FINLAND_LINE_CITATION = { sourceId: 22, quote: "[24.95276667,59.86821667],[24.8211,59.84155],[24.40611667,59.73655]" };
const HELICOPTER_CITATION = {
  sourceId: 11,
  quote: "7.34: Helikopteri tavoitti aluksen Suomen talousvyöhykkeeltä 40 kilometriä Helsingistä etelään. Tuossa vaiheessa laivan ankkuriketju oli meressä mutta alus liikkui.",
  translation: "7.34: The helicopter reached the vessel in Finland's economic zone 40 kilometres south of Helsinki. At that point the ship's anchor chain was in the sea but the ship was moving.",
};
const RAISE_ANCHOR_CITATION = {
  sourceId: 11,
  quote:
    "Alusta ohjeistettiin pysäyttämään vauhtinsa heti, nostamaan ankkurin ja siirtymään turvallisen ankkuripaikkaan Suomen aluevesille. Ankkurin nosto tapahtui rajavartioston helikopterin miehistön valvoessa ja kuvatessa toimintaa.",
  translation:
    "The vessel was told to stop at once, raise the anchor and move to a safe anchorage in Finnish territorial waters. The anchor was raised while the crew of the Border Guard helicopter watched and filmed.",
};
const CHAIN_UNDER_WAY_CITATION = {
  sourceId: 10,
  quote: "Alus tavoitettiin Suomenlahden merivartioston vartiolaiva Turvan ja helikopterin toimesta ja sen ankkuriketjun havaittiin roikkuvan vedessä aluksen ollessa kulussa.",
  translation: "The vessel was reached by the Gulf of Finland Coast Guard's patrol vessel Turva and a helicopter, and its anchor chain was seen hanging in the water while the vessel was under way.",
};
const BRIDGE_TAKEN_CITATION = {
  sourceId: 11,
  quote: "11.11: Viranomaiset ottivat Fitburgin komentosillan haltuunsa.",
  translation: "11.11: The authorities took control of Fitburg's bridge.",
};
const TERRITORIAL_WATERS_CITATION = {
  sourceId: 7,
  quote: "The vessel was instructed to proceed to a place of safety for the purposes of the investigation, and was taken into possession by the authorities upon entering Finnish territorial waters on 31 December 2025.",
};
const KANTVIK_CITATION = {
  sourceId: 3,
  quote: "The vessel Fitburg, suspected of being involved in the cable damage incident in the Gulf of Finland, was escorted by authorities to Kantvik harbour on 31 December at approximately 17:00.",
};
const PROSECUTOR_130_CITATION = {
  sourceId: 8,
  quote:
    "The captain and the bosun are suspected of having damaged two subsea telecommunications cables and of having attempted to damage a total of eight other subsea connections when Fitburg dragged its damaged anchor along the seabed in the Gulf of Finland for a distance of at least 130 kilometres, until the vessel's movement was halted by measures taken by Finnish authorities.",
};

export const FITBURG_2025: CableCase = {
  slug: "fitburg-2025",
  title: "Fitburg anchor drag",
  subtitle: "Gulf of Finland, 30 and 31 December 2025",
  summary:
    "The general cargo ship Fitburg crossed the Gulf of Finland from St Petersburg on New Year's Eve: Elisa's Helsinki to Tallinn cable failed at 04:53 local time, an Arelion cable shortly after, and a Border Guard helicopter found the ship under way with its anchor chain in the water. Prosecutors put the drag mark at about 130 km; the master and the boatswain deny the charges and the Helsinki District Court has not ruled. The track is read off a MarineTraffic map Yle published that day and timed from statements.",
  vessel: {
    name: "Fitburg",
    kind: "general-cargo",
    flag: "Saint Vincent and the Grenadines",
    type: "General cargo ship, 132 m",
    imo: "9250397",
    mmsi: "375068000",
    citations: [
      {
        sourceId: 8,
        quote:
          "The Deputy Prosecutor General has brought charges for aggravated criminal mischief and aggravated interference with telecommunications against the captain and the bosun of the cargo vessel Fitburg, registered in Saint Vincent and the Grenadines.",
      },
      { sourceId: 21, quote: "The general cargo ship is 132 meters (433 feet) in length and registered in St. Vincent and the Grenadines." },
      { sourceId: 20, quote: "The vessel FINEX (IMO 9250397, MMSI 375068000) is a General Cargo Ship built in 2001" },
      { sourceId: 21, quote: "Records show it was renamed Finex in March but continues to operate for the Turkish company and is registered in St. Vincent and the Grenadines." },
      { sourceId: 14, quote: "The ship was headed from St Petersburg, Russia to Haifa, Israel, according to a marine traffic tracking site." },
    ],
  },
  window: { startUtc: "2025-12-30T21:00:00Z", endUtc: "2025-12-31T15:30:00Z" },
  localTime: { place: "Helsinki", timeZone: "Europe/Helsinki" },
  seabedArea: "gulf-of-finland-and-hiiumaa",
  track: [
    {
      atUtc: "2025-12-30T21:20:00Z",
      longitude: 26.34571,
      latitude: 59.99117,
      precision: "area",
      place: "At the Russian border, where the drag mark begins",
      placement:
        "Where the route on Yle's map crosses the Estonia-Russia treaty line (Marine Regions), next to the Finnish line: the Russian border the prosecutor measures the 130 km from. Time: constant 8.4 knots between the route's closest approach to Suursaari (about 21:00 Finnish time) and the Elisa cable (04:53), 36.1 km after Suursaari.",
      citations: [RUSSIAN_BORDER_CITATION, TRACE_EXTENT_CITATION, TREATY_LINE_CITATION, SUURSAARI_CITATION, ROUTE_MAP_CITATION],
    },
    {
      atUtc: "2025-12-31T02:53:00Z",
      longitude: 24.86251,
      latitude: 59.82754,
      precision: "area",
      place: "Over Elisa's Helsinki to Tallinn cable, in Estonia's economic zone",
      placement:
        "Where the route on Yle's map crosses the Finland Estonia Connection (OpenStreetMap, operator Elisa), 2.5 km south of the Estonia-Finland treaty line (Marine Regions); the route crosses into Finland's zone 9.4 km further on. Time: Elisa's 04:53 Finnish time.",
      citations: [ELISA_FAULT_CITATION, FAULT_TIMES_CITATION, DAMAGE_IN_ESTONIAN_EEZ_CITATION, MOVING_INTO_FINNISH_EEZ_CITATION, ROUTE_MAP_CITATION],
    },
    {
      atUtc: "2025-12-31T05:50:00Z",
      longitude: 24.00984,
      latitude: 59.7332,
      precision: "area",
      place: "Stopped in mid-gulf south of Inkoo, where the anchor came up",
      placement:
        "The westernmost point of the route on Yle's map, where it turns back north-east: 34.8 km due south of Inkoo (Nominatim) and 135.9 km along the route from the Russian border, against the prosecutor's 'at least 130 kilometres'. Time: 'shortly before eight' Finnish time, read as 07:50.",
      citations: [STOPPED_CITATION, RAISE_ANCHOR_CITATION, TRACE_EXTENT_CITATION, PROSECUTOR_130_CITATION, ROUTE_MAP_CITATION],
    },
    {
      atUtc: "2025-12-31T09:11:00Z",
      longitude: 24.1352,
      latitude: 59.8756,
      precision: "area",
      place: "At anchor in Finnish territorial waters, off Porkkala",
      placement:
        "The end of the route on Yle's map, under its Fitburg pin: the safe anchorage the Border Guard asked for, 24.6 km south-west of Porkkalanniemi (Nominatim). Time: authorities took the bridge at 11.11 Finnish time.",
      citations: [BRIDGE_TAKEN_CITATION, TERRITORIAL_WATERS_CITATION, ROUTE_MAP_CITATION],
    },
    {
      atUtc: "2025-12-31T11:48:00Z",
      longitude: 24.1352,
      latitude: 59.8756,
      precision: "area",
      place: "Still at anchor off Porkkala",
      placement: "Same point. Yle published its MarineTraffic map at 13:48 Finnish time with the ship there; it moved on toward Upinniemi in the afternoon.",
      citations: [
        ROUTE_MAP_CITATION,
        {
          sourceId: 13,
          quote: "Merenkulkua seuraavan Marinetraffic-sivuston mukaan alus on Porkkalan edustalla. Iltapäivällä alus alkoi siirtyä ja se on neljän aikaan iltapäivästä suomalaisen saattoaluksen kanssa matkalla kohti Upinniemeä.",
          translation:
            "According to the MarineTraffic ship-tracking site, the vessel is off Porkkala. In the afternoon the vessel began to move, and at around four in the afternoon it is on its way toward Upinniemi with a Finnish escort vessel.",
        },
      ],
    },
    {
      atUtc: "2025-12-31T15:00:00Z",
      longitude: 24.38322,
      latitude: 60.0859,
      precision: "named-place",
      place: "Kantvik harbour, Kirkkonummi",
      placement: "Kantvik (OpenStreetMap district, Nominatim, 60.08590 N, 24.38322 E); the sources name the harbour, not a berth. Time: about 17:00 Finnish time.",
      citations: [
        KANTVIK_CITATION,
        { sourceId: 11, quote: "17.00: Alus saapui Kirkkonummen Kantvikin satamaan raskaasti vartioituna.", translation: "17.00: The vessel arrived at Kantvik harbour in Kirkkonummi under heavy guard." },
      ],
    },
  ],
  // No public AIS archive covers the Gulf of Finland on these dates (plan/research/historical-ais-coverage.md).
  recordedTrack: null,
  dragWindow: {
    startUtc: "2025-12-30T21:20:00Z",
    endUtc: "2025-12-31T05:50:00Z",
    citations: [
      RUSSIAN_BORDER_CITATION,
      {
        sourceId: 18,
        quote:
          "Syyttäjien mukaan kapteenin ja pursimiehen toiminnan seurauksena Fitburg-alus veti perässään ankkuriketjua ja sen päässä olevaa vaurioituneen ankkurin tukkia meren pohjaa pitkin Suomen aluevesien ulkopuolisella merialueella usean tunnin ajan noin 130 kilometrin matkan.",
        translation:
          "According to the prosecutors, as a result of the captain's and the boatswain's actions Fitburg dragged its anchor chain, with the shank of the damaged anchor at its end, along the seabed outside Finnish territorial waters for several hours over about 130 kilometres.",
      },
      CHAIN_UNDER_WAY_CITATION,
      RAISE_ANCHOR_CITATION,
    ],
  },
  cuts: [
    {
      cableName: "Finland Estonia Connection (FEC)",
      label: "Elisa cable",
      owner: "Elisa",
      atUtc: "2025-12-31T02:53:00Z",
      longitude: 24.86251,
      latitude: 59.82754,
      precision: "area",
      placement:
        "No source names the cable or the spot. OpenStreetMap maps one Elisa cable between Helsinki and Tallinn, the Finland Estonia Connection; the point is where the route on Yle's map first crosses it, 2.5 km inside Estonia's zone. The time is when Elisa reported the fault.",
      citations: [ELISA_FAULT_CITATION, FAULT_TIMES_CITATION, DAMAGE_IN_ESTONIAN_EEZ_CITATION, ESTONIA_FINLAND_LINE_CITATION],
    },
    {
      cableName: "Finland-Estonia 2 (EESF-2)",
      label: "Arelion cable",
      owner: "Arelion Finland",
      atUtc: "2025-12-31T02:59:00Z",
      longitude: 24.83357,
      latitude: 59.82502,
      precision: "area",
      placement:
        "No source names the cable. Of the two Arelion cables between Finland and Estonia on OpenStreetMap, the route on Yle's map crosses EESF-2 1.7 km after the Elisa cable and 2.1 km inside Estonia's zone, and EESF-3 inside Finland's. Time: 'shortly afterwards', placed 6 minutes later at the route's 8.4 knots.",
      citations: [FAULT_TIMES_CITATION, DAMAGE_IN_ESTONIAN_EEZ_CITATION, CABLES_CLOSE_CITATION, ESTONIA_FINLAND_LINE_CITATION],
    },
  ],
  events: [
    {
      atUtc: "2025-12-31T02:53:00Z",
      isTimeApproximate: false,
      kind: "cable-fault",
      title: "Elisa reports a fault on its Helsinki to Tallinn cable",
      citations: [
        ELISA_FAULT_CITATION,
        {
          sourceId: 1,
          quote: "Telecommunications provider Elisa detected a fault in the company's telecommunications cable between Helsinki and Tallinn early in the morning on 31 December 2025.",
        },
      ],
    },
    {
      atUtc: "2025-12-31T02:59:00Z",
      isTimeApproximate: true,
      kind: "cable-fault",
      title: "A fault on an Arelion cable follows",
      citations: [FAULT_TIMES_CITATION, CABLES_CLOSE_CITATION],
    },
    {
      atUtc: "2025-12-31T05:34:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "A Border Guard helicopter reaches the ship: the anchor chain is in the water and the ship is moving",
      citations: [HELICOPTER_CITATION, CHAIN_UNDER_WAY_CITATION],
    },
    {
      atUtc: "2025-12-31T05:50:00Z",
      isTimeApproximate: true,
      kind: "anchor",
      title: "Told to stop and raise the anchor; it comes up under the helicopter's watch",
      citations: [RAISE_ANCHOR_CITATION, STOPPED_CITATION, { sourceId: 1, quote: "The vessel's anchor chain was found to be lowered into the sea. The Border Guard instructed the vessel to stop and raise the anchor." }],
    },
    {
      atUtc: "2025-12-31T07:00:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Patrol vessel Turva arrives; the anchor is up",
      citations: [{ sourceId: 11, quote: "9.00: Vartiolaiva Turva saapui paikalle Fitburg-aluksen ankkurin ollessa ylhäällä.", translation: "9.00: The patrol vessel Turva arrived on the scene with Fitburg's anchor up." }],
    },
    {
      atUtc: "2025-12-31T08:25:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "The Coast Guard hands command to the Helsinki police",
      citations: [
        {
          sourceId: 11,
          quote: "10.25: Suomenlahden merivartiosto siirsi johtovastuun tapauksesta Helsingin poliisille.",
          translation: "10.25: The Gulf of Finland Coast Guard handed command of the case to the Helsinki police.",
        },
      ],
    },
    {
      atUtc: "2025-12-31T09:05:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Police and Border Guard teams rope down from helicopters onto the deck",
      citations: [
        {
          sourceId: 11,
          quote: "11.05: Poliisin valmiusyksikkö Karhu ja Rajavartiolaitoksen valmiusjoukkue laskeutuivat helikoptereista aluksen kannelle köysillä.",
          translation: "11.05: The police Karhu response unit and the Border Guard's response team roped down from helicopters onto the vessel's deck.",
        },
        { sourceId: 2, quote: "The police rapid response unit Karhu and the Border Guard's tactical team fast-roped down to the vessel's deck from helicopters." },
      ],
    },
    {
      atUtc: "2025-12-31T09:11:00Z",
      isTimeApproximate: false,
      kind: "authorities",
      title: "Authorities take the bridge; the 14 crew are held",
      citations: [
        BRIDGE_TAKEN_CITATION,
        { sourceId: 14, quote: "At a multi-agency press conference on Wednesday afternoon, National Police Commissioner Ilkka Koskimäki said that the Fitburg was seized at around 11am that day." },
        { sourceId: 14, quote: "There were 14 crewmembers aboard the ship, who were taken into custody, he said." },
      ],
    },
    {
      atUtc: "2025-12-31T15:00:00Z",
      isTimeApproximate: true,
      kind: "vessel",
      title: "Escorted into Kantvik harbour",
      citations: [KANTVIK_CITATION],
    },
  ],
  aftermath: [
    {
      atUtc: "2026-01-01T12:58:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Two crew members arrested and two under a travel ban; a seabed crime scene investigation begins",
      citations: [
        { sourceId: 3, quote: "The police have arrested two individuals and two other persons have been subjected to a travel ban." },
        { sourceId: 3, quote: "The authorities have also initiated a subsea crime scene investigation in the area surrounding the damaged cable." },
      ],
    },
    {
      atUtc: "2026-01-04T14:00:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Police: a drag mark of at least several tens of kilometres leads to the Elisa cable damage",
      citations: [
        {
          sourceId: 4,
          quote:
            "Based on the examinations conducted so far, there is reason to suspect that the anchor and anchor chain of the Fitburg vessel have dragged along the seabed for at least several tens of kilometres before reaching the point of damage to the telecommunications cable owned by Elisa.",
        },
      ],
    },
    {
      atUtc: "2026-01-07T06:00:00Z",
      isTimeApproximate: false,
      kind: "investigation",
      title: "The National Bureau of Investigation seizes the ship",
      citations: [{ sourceId: 5, quote: "The seizure took place today, 7 January, at 08:00 AM." }],
    },
    {
      atUtc: "2026-01-12T09:00:00Z",
      isTimeApproximate: true,
      kind: "authorities",
      title: "The seizure is lifted and the ship leaves Kantvik",
      citations: [{ sourceId: 6, quote: "The Fitburg vessel will leave Finland's territorial waters on January 12, 2026. The vessel departs from the port at approximately 11 a.m." }],
    },
    {
      atUtc: "2026-06-05T14:01:00Z",
      isTimeApproximate: true,
      kind: "investigation",
      title: "Investigation concluded with four suspects; the case goes to the prosecutor",
      citations: [
        { sourceId: 7, quote: "The investigation concluded with four suspects, three of whom remain subject to a travel ban." },
        { sourceId: 7, quote: "The criminal investigation is complete and the case will be now referred to prosecution authorities for consideration of charges." },
      ],
    },
    {
      atUtc: "2026-06-15T11:35:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Charges against the master and the boatswain; both deny them and contest Finland's jurisdiction",
      citations: [
        PROSECUTOR_130_CITATION,
        {
          sourceId: 8,
          quote:
            "In the preliminary investigation, the defendants have denied that they committed the offences. They also consider that Finland lacks jurisdiction in the case, as the locations of the cable damages are outside Finnish territorial waters.",
        },
      ],
    },
    {
      atUtc: "2026-09-08T06:00:00Z",
      isTimeApproximate: false,
      kind: "court",
      title: "Trial opens in Helsinki District Court, which finds itself competent; both men deny the charges",
      citations: [
        { sourceId: 9, quote: "Pääkäsittely alkaa 8.9.2026 istuntosalissa 209 klo 9.00.", translation: "The main hearing begins on 8.9.2026 in courtroom 209 at 9.00." },
        { sourceId: 16, quote: "The court said at the start of Tuesday's hearing that it considers itself competent to hear the case." },
        {
          sourceId: 19,
          quote: "They face at least two and a half years in prison if found guilty on the charges of aggravated sabotage and aggravated interference with communications networks. Both men have denied the charges.",
        },
        { sourceId: 16, quote: "The investigation did find a drag mark on the seabed that followed Fitburg's route and matched the width and profile of the ship's anchor structure." },
      ],
    },
    {
      atUtc: "2026-10-08T14:00:00Z",
      isTimeApproximate: true,
      kind: "court",
      title: "Closing statements; the judgment is due in November",
      citations: [
        {
          sourceId: 17,
          quote: "Viimeisen istuntopäivän päätteeksi käräjäoikeus määräsi syytetyt matkustuskieltoon, kunnes lopullinen tuomio asiassa annetaan marraskuussa.",
          translation: "At the end of the last day of hearings, the district court placed the defendants under a travel ban until the final judgment, which will be given in November.",
        },
        {
          sourceId: 17,
          quote: "Sitä emme tiedä, missä vaiheessa ankkuri on sitä ennen joutunut veteen.",
          translation: "What we do not know is at what point before that the anchor went into the water.",
        },
      ],
    },
  ],
  sources: [
    {
      id: 1,
      publisher: "Police of Finland",
      title: "Police Investigate Cable Damage in the Gulf of Finland in Cooperation with Other Authorities",
      url: "https://poliisi.fi/en/-/police-investigate-cable-damage-in-the-gulf-of-finland-in-cooperation-with-other-authorities",
      publishedOn: "2025-12-31",
      archivedUrl: "https://web.archive.org/web/20251231113216/https://poliisi.fi/en/-/police-investigate-cable-damage-in-the-gulf-of-finland-in-cooperation-with-other-authorities",
    },
    {
      id: 2,
      publisher: "Police of Finland",
      title: "Cargo Vessel Fitburg has been moved to a Safe Place",
      url: "https://poliisi.fi/en/-/cargo-vessel-fitburg-moved-to-a-safe-place",
      publishedOn: "2025-12-31",
      archivedUrl: "https://web.archive.org/web/20251231194701/https://poliisi.fi/en/-/cargo-vessel-fitburg-moved-to-a-safe-place",
    },
    {
      id: 3,
      publisher: "Police of Finland",
      title: "Investigation Related to Vessel Fitburg Continues",
      url: "https://poliisi.fi/en/-/investigation-related-to-vessel-fitburg-continues",
      publishedOn: "2026-01-01",
      archivedUrl: "https://web.archive.org/web/20260101160649/https://poliisi.fi/en/-/investigation-related-to-vessel-fitburg-continues",
    },
    {
      id: 4,
      publisher: "Police of Finland",
      title: "Maritime Investigations in the Gulf of Finland Continue",
      url: "https://poliisi.fi/en/-/merelliset-tutkimukset-suomenlahdella-jatkuvat-2",
      publishedOn: "2026-01-04",
      archivedUrl: "https://web.archive.org/web/20260104191258/https://poliisi.fi/en/-/merelliset-tutkimukset-suomenlahdella-jatkuvat-2",
    },
    {
      id: 5,
      publisher: "Police of Finland",
      title: "The Fitburg Vessel Seized by the National Bureau of Investigation",
      url: "https://poliisi.fi/en/-/the-fitburg-vessel-seized-by-the-national-bureau-of-investigation",
      publishedOn: "2026-01-07",
      archivedUrl: "https://web.archive.org/web/20260107145530/https://poliisi.fi/en/-/the-fitburg-vessel-seized-by-the-national-bureau-of-investigation",
    },
    {
      id: 6,
      publisher: "Police of Finland",
      title: "Fitburg Vessel to move to international waters under Border Guard's control",
      url: "https://poliisi.fi/en/-/fitburg-vessel-to-move-to-international-waters-under-border-guard-s-control",
      publishedOn: "2026-01-12",
      archivedUrl: "https://web.archive.org/web/20260112102255/https://poliisi.fi/en/-/fitburg-vessel-to-move-to-international-waters-under-border-guard-s-control",
    },
    {
      id: 7,
      publisher: "Police of Finland",
      title: "Investigation into Fitburg cable damage concluded",
      url: "https://poliisi.fi/en/-/investigation-into-fitburg-cable-damage-concluded",
      publishedOn: "2026-06-05",
      archivedUrl: "https://web.archive.org/web/20260605190842/https://poliisi.fi/en/-/investigation-into-fitburg-cable-damage-concluded",
    },
    {
      id: 8,
      publisher: "National Prosecution Authority of Finland",
      title: "Charges brought in the case concerning the cutting of submarine cables in the Gulf of Finland on New Year's Eve 2025",
      url: "https://www.syyttajalaitos.fi/en/news/news-archive/charges-brought-in-the-case-concerning-the-cutting-of-submarine-cables-in-the-gulf-of-finland-on-new-years-eve-2025/",
      publishedOn: "2026-06-15",
      archivedUrl:
        "https://web.archive.org/web/20260822081845/https://www.syyttajalaitos.fi/en/news/news-archive/charges-brought-in-the-case-concerning-the-cutting-of-submarine-cables-in-the-gulf-of-finland-on-new-years-eve-2025/",
    },
    {
      id: 9,
      publisher: "Helsinki District Court",
      title: "Käsittelytiedote asiassa R 706/2026/11841",
      url: "https://www.tuomioistuimet.fi/ajankohtaista/tiedotteet/kasittelytiedote-asiassa-r-706-2026-11841/",
      publishedOn: "2026-09-03",
      archivedUrl: "https://web.archive.org/web/20260914040724/https://www.tuomioistuimet.fi/ajankohtaista/tiedotteet/kasittelytiedote-asiassa-r-706-2026-11841/",
    },
    {
      id: 10,
      publisher: "Finnish Border Guard",
      title: "Suomenlahden merivartioston viikko 1",
      url: "https://raja.fi/-/suomenlahden-merivartioston-viikko-1-1",
      publishedOn: "2026-01-05",
      archivedUrl: "https://web.archive.org/web/20260105143758/https://raja.fi/-/suomenlahden-merivartioston-viikko-1-1",
    },
    {
      id: 11,
      publisher: "MTV Uutiset",
      title: "Näin eteni viranomaisoperaatio Suomenlahdella",
      url: "https://www.mtvuutiset.fi/artikkeli/kun-elisa-ilmoitti-aamuvarhaisella-kaapelirikosta-alkoi-viranomaisten-suuroperaatio-nain-se-eteni/9276622",
      publishedOn: "2026-01-01",
      archivedUrl: "https://web.archive.org/web/20260101085423/https://www.mtvuutiset.fi/artikkeli/kun-elisa-ilmoitti-aamuvarhaisella-kaapelirikosta-alkoi-viranomaisten-suuroperaatio-nain-se-eteni/9276622",
    },
    {
      id: 12,
      publisher: "Verkkouutiset",
      title: "Tällainen on kaapelivauriosta epäilty alus - rekisteröity karibialaiselle pikkusaarelle",
      url: "https://www.verkkouutiset.fi/a/tallainen-on-kaapelivauriosta-epailty-alus-rekisteroity-karibialaiselle-pikkusaarelle/",
      publishedOn: "2025-12-31",
      archivedUrl: "https://web.archive.org/web/20251231125925/https://www.verkkouutiset.fi/a/tallainen-on-kaapelivauriosta-epailty-alus-rekisteroity-karibialaiselle-pikkusaarelle/",
    },
    {
      id: 13,
      publisher: "Yle",
      title: "Elisan merikaapeliyhteys Suomenlahdella vaurioitunut, myös Virossa kaapelivaurioita: alueella liikkunut Fitburg-alus otettu haltuun",
      url: "https://yle.fi/a/74-20202088",
      publishedOn: "2025-12-31",
      archivedUrl: "https://web.archive.org/web/20251231115337/https://yle.fi/a/74-20202088",
    },
    {
      id: 14,
      publisher: "Yle News",
      title: "Finnish authorities seize vessel following sea cable disruption",
      url: "https://yle.fi/a/74-20202087",
      publishedOn: "2025-12-31",
      archivedUrl: "https://web.archive.org/web/20251231115812/https://yle.fi/a/74-20202087",
    },
    {
      id: 15,
      publisher: "ERR News",
      title: "Finland detains vessel after cable damaged between Tallinn and Helsinki",
      url: "https://news.err.ee/1609898537/finland-detains-vessel-after-cable-damaged-between-tallinn-and-helsinki",
      publishedOn: "2025-12-31",
      archivedUrl: "https://web.archive.org/web/20251231130615/https://news.err.ee/1609898537/finland-detains-vessel-after-cable-damaged-between-tallinn-and-helsinki",
    },
    {
      id: 16,
      publisher: "Helsinki Times",
      title: "Fitburg crew trial begins over Baltic Sea cable damage",
      url: "https://www.helsinkitimes.fi/finland/finland-news/domestic/29250-fitburg-trial-begins-in-finland-over-baltic-sea-cable-damage.html",
      publishedOn: "2026-09-08",
      archivedUrl: "https://web.archive.org/web/20260908123348/https://www.helsinkitimes.fi/finland/finland-news/domestic/29250-fitburg-trial-begins-in-finland-over-baltic-sea-cable-damage.html",
    },
    {
      id: 17,
      publisher: "SSS (STT)",
      title: "Olivatko Suomenlahden kaapelivauriot vahinko, tahallinen teko vai seurausta piilevästä teknisestä viasta? Oikeudenkäynti päättyi loppulausuntoihin",
      url: "https://www.sss.fi/2026/10/olivatko-suomenlahden-kaapelivauriot-vahinko-tahallinen-teko-vai-seurausta-piilevasta-teknisesta-viasta-oikeudenkaynti-paattyi-loppulausuntoihin/",
      publishedOn: "2026-10-08",
      archivedUrl:
        "https://web.archive.org/web/20261008154627/https://www.sss.fi/2026/10/olivatko-suomenlahden-kaapelivauriot-vahinko-tahallinen-teko-vai-seurausta-piilevasta-teknisesta-viasta-oikeudenkaynti-paattyi-loppulausuntoihin/",
    },
    {
      id: 18,
      publisher: "SSS (STT)",
      title: 'KORJAUS: Suomenlahden merikaapelivaurioista syytetyille vaaditaan ehdottomia vankeusrangaistuksia, kapteenin puolustus: Meren pohjassa raahautunut ankkuri oli "täysi yllätys"',
      url: "https://www.sss.fi/2026/09/korjaus-suomenlahden-merikaapelivaurioista-syytetyille-vaaditaan-ehdottomia-vankeusrangaistuksia-kapteenin-puolustus-meren-pohjassa-raahautunut-ankkuri-oli-taysi-yllatys/",
      publishedOn: "2026-09-09",
      archivedUrl:
        "https://web.archive.org/web/20260909114705/https://www.sss.fi/2026/09/korjaus-suomenlahden-merikaapelivaurioista-syytetyille-vaaditaan-ehdottomia-vankeusrangaistuksia-kapteenin-puolustus-meren-pohjassa-raahautunut-ankkuri-oli-taysi-yllatys/",
    },
    {
      id: 19,
      publisher: "Yle News",
      title: "Fitburg defendants deny sabotage as second anchor-dragging trial begins",
      url: "https://yle.fi/a/74-20245189",
      publishedOn: "2026-09-08",
      archivedUrl: "https://web.archive.org/web/20260908171642/https://yle.fi/a/74-20245189",
    },
    {
      id: 20,
      publisher: "VesselFinder",
      title: "FINEX, General Cargo Ship, IMO 9250397",
      url: "https://www.vesselfinder.com/vessels/details/9250397",
      publishedOn: "2026-10-17",
      archivedUrl: "https://web.archive.org/web/20250123214517/https://www.vesselfinder.com/vessels/details/9250397",
    },
    {
      id: 21,
      publisher: "The Maritime Executive",
      title: "Captain and Boatswain Go on Trial in Finland for Anchor Dragging Incident",
      url: "https://maritime-executive.com/article/captain-and-boatswain-go-on-trial-in-finland-for-anchor-dragging-incident",
      publishedOn: "2026-09-09",
      archivedUrl: "https://web.archive.org/web/20260909205510/https://maritime-executive.com/article/captain-and-boatswain-go-on-trial-in-finland-for-anchor-dragging-incident",
    },
    {
      id: 22,
      publisher: "Flanders Marine Institute (VLIZ), Marine Regions",
      title: "Maritime boundaries (eez_boundaries), WFS extract for 20.5 to 28.5 E, 58.5 to 60.6 N",
      url: "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=MarineRegions:eez_boundaries&outputFormat=application/json&bbox=20.5,58.5,28.5,60.6",
      publishedOn: "2026-10-17",
      archivedUrl: null,
    },
  ],
};
