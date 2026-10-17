// The electricity bidding zones around the Baltic and the North Sea, by EIC code, with the country (ISO 3166-1
// alpha-2) each lies in. Codes from ENTSO-E's list of area codes,
// https://eepublicdownloads.blob.core.windows.net/cio-lio/csv/Y_eicCodes.csv (read 17 Oct 2026). The ENTSO-E outage
// documents and the Nord Pool urgent market messages both name the two ends of a link by these codes.

const ZONE_COUNTRIES: Readonly<Record<string, string>> = {
  "10Y1001A1001A39I": "EE",
  "10YFI-1--------U": "FI",
  "10YLV-1001A00074": "LV",
  "10YLT-1001A0008Q": "LT",
  "10YPL-AREA-----S": "PL",
  "10Y1001A1001A44P": "SE",
  "10Y1001A1001A45N": "SE",
  "10Y1001A1001A46L": "SE",
  "10Y1001A1001A47J": "SE",
  "10Y1001A1001A82H": "DE",
  "10YDK-1--------W": "DK",
  "10YDK-2--------M": "DK",
  "10YNO-1--------2": "NO",
  "10YNO-2--------T": "NO",
  "10YNO-3--------J": "NO",
  "10YNO-4--------9": "NO",
  "10Y1001A1001A48H": "NO",
};

/** The country of a bidding zone, or null for a zone outside the list. */
export function countryOfZone(eicCode: string): string | null {
  return ZONE_COUNTRIES[eicCode.trim()] ?? null;
}

/** The EIC code of a country's single bidding zone, for the countries that have exactly one (FI, EE, LV, LT, PL). */
export function zoneOfCountry(country: string): string | null {
  const zones = Object.entries(ZONE_COUNTRIES).filter((entry) => entry[1] === country);
  return zones.length === 1 ? (zones[0]?.[0] ?? null) : null;
}
