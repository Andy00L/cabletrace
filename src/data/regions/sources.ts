import type { LineSource, LineSourceId, LiveSource, LiveSourceId } from "@/lib/regions/region";

// The feeds and route datasets the regions draw on, with their terms as read on 2026-10-17.

export const LIVE_SOURCES: Readonly<Record<LiveSourceId, LiveSource>> = {
  digitraffic: {
    id: "digitraffic",
    name: "Fintraffic Digitraffic marine AIS",
    url: "https://www.digitraffic.fi/en/marine-traffic/",
    licence: "CC BY 4.0",
    // Same credit as SOURCE_CREDITS in src/lib/live/frame-layout.ts.
    credit: "Fintraffic / digitraffic.fi",
    maxRetentionHours: null,
  },
  aisstream: {
    id: "aisstream",
    name: "aisstream.io",
    url: "https://aisstream.io/documentation",
    // No terms page exists (/terms, /tos, /legal, /faq answer 404, plan decision log 2026-10-17).
    licence: "no published terms",
    credit: "aisstream.io",
    // Project rule for a source without terms: nothing older than 2 days (FRAME_RETENTION_MS in
    // src/lib/live/frame-layout.ts keeps frames 47 hours for the same reason).
    maxRetentionHours: 47,
  },
};

export const LINE_SOURCES: Readonly<Record<LineSourceId, LineSource>> = {
  openstreetmap: {
    id: "openstreetmap",
    name: "OpenStreetMap submarine cables and pipelines",
    url: "https://www.openstreetmap.org/copyright",
    licence: "ODbL 1.0",
    credit: "OpenStreetMap contributors (ODbL 1.0)",
  },
  "emodnet-human-activities": {
    id: "emodnet-human-activities",
    name: "EMODnet Human Activities pipelines",
    url: "https://emodnet.ec.europa.eu/en/human-activities",
    licence: "CC BY 4.0",
    credit: "EMODnet Human Activities (CC BY 4.0)",
  },
  "acma-cable-locations-2021": {
    id: "acma-cable-locations-2021",
    name: "Australia's Submarine Telecommunication Cable Locations 2021 (ACMA, via Geoscience Australia and AODN)",
    url: "https://data.gov.au/data/dataset/ff6403dc-875a-46bc-b9ac-114772148902",
    // The data.gov.au record links the CC BY 4.0 badge (licensebuttons.net/l/by/4.0) while its licence field reads
    // "notspecified"; treated as CC BY 4.0 and credited.
    licence: "CC BY 4.0",
    credit: "ACMA submarine cable locations 2021, Geoscience Australia / AODN (CC BY 4.0)",
  },
};
