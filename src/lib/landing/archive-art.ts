// Written by scripts/art/build-archive-art.ts; do not edit by hand. Sizes are the cropped original's, in px.
export type ArchiveArtName = "great-eastern-under-weigh" | "preparing-to-grapple" | "albany-at-night" | "searching-for-the-fault";

export type ArchiveArt = {
  width: number;
  height: number;
  widths: readonly number[];
  title: string;
  shortTitle: string;
  creator: string;
  date: string;
  alt: string;
  pageUrl: string;
  licence: { name: string; url: string };
};

/** Files at /landing/archive/<name>-<width>.avif and .webp. */
export const ARCHIVE_ART: Readonly<Record<ArchiveArtName, ArchiveArt>> = {
  "great-eastern-under-weigh": {"width":3790,"height":2182,"widths":[1200,2000,2800],"title":"The Great Eastern Under Weigh, July 23rd, 1865: Escort and other Ships, H.M.S. Terrible, H.M.S. Sphinx, The Hawk and Revised: The Caroline","shortTitle":"The Great Eastern Under Weigh, July 23rd, 1865","creator":"Robert Charles Dudley","date":"1865-66","alt":"Watercolour of the Great Eastern under steam on 23 July 1865, smoke trailing from her funnels under a gold evening sky, her escort ships around her on a rolling sea","pageUrl":"https://www.metmuseum.org/art/collection/search/383821","licence":{"name":"Public domain (CC0)","url":"https://creativecommons.org/publicdomain/zero/1.0/"}},
  "preparing-to-grapple": {"width":3272,"height":2311,"widths":[1200,2000],"title":"In the Bows of the Great Eastern: The Cable Broken and Lost, Preparing to Grapple, August 2nd, 1865","shortTitle":"In the Bows of the Great Eastern: The Cable Broken and Lost, Preparing to Grapple, August 2nd, 1865","creator":"Robert Charles Dudley","date":"1865","alt":"Watercolour of the Great Eastern's bow on 2 August 1865, after the Atlantic cable broke: a grapnel hangs from the bow, the crew crowd the deck and rigging, and red buoys are swung out over the side","pageUrl":"https://www.metmuseum.org/art/collection/search/383827","licence":{"name":"Public domain (CC0)","url":"https://creativecommons.org/publicdomain/zero/1.0/"}},
  "albany-at-night": {"width":3299,"height":2004,"widths":[1200,2000,2800],"title":"The Albany Buoying a Bight of the Cable of 1865 on the Night of August 26th, 1866","shortTitle":"The Albany Buoying a Bight of the Cable of 1865 on the Night of August 26th, 1866","creator":"Robert Charles Dudley","date":"1866","alt":"Watercolour of the Albany at night on 26 August 1866, pitching in a heavy sea under a clouded moon, a line running from her bow into the water","pageUrl":"https://www.metmuseum.org/art/collection/search/364364","licence":{"name":"Public domain (CC0)","url":"https://creativecommons.org/publicdomain/zero/1.0/"}},
  "searching-for-the-fault": {"width":3600,"height":2437,"widths":[1200,2000,2800],"title":"Searching for the Fault after Hauling Back the Cable from the Bottom of the Atlantic, July 31st, 1865","shortTitle":"Searching for the Fault after Hauling Back the Cable from the Bottom of the Atlantic, July 31st, 1865","creator":"Robert Charles Dudley","date":"1865","alt":"Watercolour of the Great Eastern's deck in 1865: men in coats and bowler hats pass the hauled-up Atlantic cable through their hands, looking for the fault","pageUrl":"https://www.metmuseum.org/art/collection/search/383826","licence":{"name":"Public domain (CC0)","url":"https://creativecommons.org/publicdomain/zero/1.0/"}},
};
