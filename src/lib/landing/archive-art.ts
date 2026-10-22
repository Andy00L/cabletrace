// Written by scripts/art/build-archive-art.ts; do not edit by hand. Sizes are the cropped original's, in px.
export type ArchiveArtName = "searching-for-the-fault" | "cable-fleet-at-sea";

export type ArchiveArt = {
  width: number;
  height: number;
  widths: readonly number[];
  title: string;
  creator: string;
  date: string;
  alt: string;
  pageUrl: string;
  licence: { name: string; url: string };
};

/** Files at /landing/archive/<name>-<width>.avif and .webp. */
export const ARCHIVE_ART: Readonly<Record<ArchiveArtName, ArchiveArt>> = {
  "searching-for-the-fault": {"width":3600,"height":2437,"widths":[1200,2000,2800],"title":"Searching for the Fault after Hauling Back the Cable from the Bottom of the Atlantic, July 31st, 1865","creator":"Robert Charles Dudley","date":"1865","alt":"Watercolour of the Great Eastern's deck in 1865: men in coats and bowler hats pass the hauled-up Atlantic cable through their hands, looking for the fault","pageUrl":"https://www.metmuseum.org/art/collection/search/383826","licence":{"name":"Public domain (CC0)","url":"https://creativecommons.org/publicdomain/zero/1.0/"}},
  "cable-fleet-at-sea": {"width":3305,"height":2054,"widths":[1200,2000,2800],"title":"Telegraph Cable Fleet at Sea, 1865","creator":"Robert Charles Dudley","date":"1865-66","alt":"Watercolour of the Great Eastern under steam and sail in a rough sea in 1865, two escort ships behind her and a red buoy marking the cable","pageUrl":"https://www.metmuseum.org/art/collection/search/364369","licence":{"name":"Public domain (CC0)","url":"https://creativecommons.org/publicdomain/zero/1.0/"}},
};
