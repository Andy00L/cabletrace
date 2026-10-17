# Fault signals and draft cases

When a cable breaks, the network side often says so before anyone looks at ships. A power link trips and its operator
publishes an outage notice, a country's internet drops, a hydrographic office warns that a cable ship is at work. CableTrace
reads those signals, matches each one to the cables it records, and opens a draft case with the ships recorded near the
affected cable before the fault, ranked by the anchor-drag detector.

A draft case is a list of ships to look at first. It is never a finding. The database refuses any status except `draft`,
every ranked ship carries the sentences that explain its rank, and the public functions return `status: "draft"` on
every row.

Facts below were read on 17 Oct 2026 unless a date says otherwise. UNCONFIRMED marks what could not be checked.

## Code

| Path | What it does |
| --- | --- |
| `src/lib/fault-signals/` | Parsers for each source, the matcher, the draft-case builder, the payload parsers and the browser fetchers. Pure TypeScript that imports only itself, `src/lib/detection` and the `Result` type, so the edge function (Deno), the replay (Bun) and the site share it. `module-boundaries.test.ts` enforces this. |
| `supabase/migrations/20261019300000_fault_signals.sql` | Tables, landing countries of the seeded cables, the service-role functions and the capped public functions. |
| `supabase/migrations/20261019300100_fault_signals_schedule.sql` | pg_cron jobs for the three sources and the daily prune. |
| `supabase/functions/match-fault-signals/` | The scheduled edge function: fetch, keep unseen signals, match, build drafts, store the call in one transaction. |
| `scripts/fault-signals/replay-known.ts` | The outside judge: replays the Estlink 2 failure and the 17 Oct 2026 NGA feed. Exit 0, 1 or 2. |

## Sources

### NGA navigational warnings

- Endpoint `https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active`, public, no key. A single
  warning is at `...broadcast-warn?output=json&navArea=P&msgYear=2024&msgNumber=1561`, which each signal links to.
- **The feed is frozen.** It answered 386 active warnings, and the newest is dated 10 May 2024. NGA's own
  `/api/publications/broadcast-warn/latest-warning` answers `{"date":"2024-05-10T15:42:00Z"}`, and queries for
  `msgYear=2025` and `msgYear=2026` return empty lists. The 386 include the 24 warnings that mention a cable, all
  dated 2023 or 2024. Until NGA publishes again, this source finds nothing new.
- The NGA broadcast areas (HYDROLANT, HYDROPAC, HYDROARC, NAVAREA IV and XII) do not cover the Baltic, where every
  recorded cable lies. Baltic warnings come from NAVAREA I (UK) and the national services (Fintraffic, Sjofartsverket).
  Neither is wired in. The Digitraffic nautical-warning path the ambition pass tried still answers 404.
- Of the 24 cable warnings, the parser keeps 14 (cable operations by a named cable ship along a trackline or in an
  area) and drops 10: 8 survey ships towing seismic streamers ("TOWING 12 8000 METER LONG CABLES"), a man overboard
  from a cable ship, and a standing prohibited area over cables off Madagascar. The replay checks each against a reading
  by hand.
- A cable warning does not date the fault. Repair ships sail days after a cut, so a draft for an NGA signal looks at
  the 72 hours before the warning was issued (`NGA_FAULT_LOOKBACK_MS`), plus the detector's 6-hour lookback, cut to 96
  hours in all.
- Terms: the site links a "Commercial Use Warning" and a "Legal Disclaimer & Security Policy" whose text loads from a
  script that a plain fetch could not read. NGA is a US federal agency, and works of the US government are generally
  not under copyright (17 U.S.C. 105), but the terms of this feed are UNCONFIRMED. Signals keep the warning text as
  their excerpt (at most 2,000 characters).

### IODA outage alerts

- Endpoint `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=<unix>&until=<unix>&entityType=country`,
  public, no key. Leaving out `entityCode` returns every country in one call: 50 alerts (12.7 kB) for 15 and 16 Oct 2026.
- An alert has a data source (`bgp`, `ping-slash24`, `gtr`, `gtr-sarima`), a country, a time, and a level. `critical`
  means the series dropped below IODA's threshold (`< 0.8` for active probing, `< 0.99` for BGP in that sample).
  `normal` means it recovered. Each critical alert becomes one signal, ended by the next `normal` alert of the same
  country and data source.
- An internet outage names a country, and a country holds many cables (Finland has 9 telecom cables in the registry).
  The ambition pass also found no Estonian country-level alert for 25 and 26 Dec 2024. So an IODA signal never opens a
  draft by itself. It joins the draft of a telecom cable in that country opened by another signal within a day, either
  in the same call or when that draft opens later.
- Terms: every answer says "This data is Copyright (c) 2021-2025 Georgia Tech Research Corporation. All Rights
  Reserved." Neither the API description (`/v2/`) nor the site's about, acknowledgements and resources pages publish
  terms of use or redisplay permission. The project contact in the site's code is `ioda-info@cc.gatech.edu`.
  **IODA's series must not be shown until IODA grants permission.** CableTrace stores only the country, the data
  source name and the alert time, never IODA's values, keeps no excerpt, and links to IODA's own country page.
- An older outage did not come back. A query for Tonga around the 15 Jan 2022 eruption (alerts and events) returned
  empty lists, so a historical IODA replay is not possible from this API.

### ENTSO-E unavailability of transmission infrastructure

- Data item "Unavailability of Transmission Infrastructure [10.1.A&B]", `documentType=A78`, at
  `https://web-api.tp.entsoe.eu/api`. The request needs a security token. Without one the API answers HTTP 401 with an
  acknowledgement "Authentication failed." (measured). The token is free and Andy has to request it.
- The answer is a ZIP of up to 200 XML documents (`offset` pages further). `zip-entries.ts` reads it with the
  `DecompressionStream` that Deno, Bun and browsers share, so no dependency was added.
- The function asks for forced outages (`BusinessType=A54`) published or updated in the last 2 hours, on both
  directions of each border that a registry power cable crosses (today FI and EE, for Estlink 1 and 2). Sweden has four
  bidding zones, so its links need a zone per cable before they can be queried.
- The parser keeps forced outages of AC or DC links (`B21`, `B22`) and skips cancelled or withdrawn documents
  (`A09`, `A13`), planned maintenance (`A53`) and transformers. Transparency Regulation article 10.4 lets an operator
  withhold the asset. Then the signal names only the border, and the matcher opens a draft on every power cable across
  it, each saying it is one of them.
- The fixture holds the documented example of the official API collection (a cancelled, planned FR-BE outage) and a
  document **constructed for the tests** from the same structure with the values of Fingrid's Estlink 2 market message.
  ENTSO-E did not publish that second document. No real forced-outage XML could be fetched without a token, so the
  element names of the forced path are UNCONFIRMED against a live answer.
- Terms: the platform's "Legal Terms and Conditions" (help-centre article updated 22 Sep 2026) state that ENTSO-E
  publishes a list of data open for free re-use under CC BY 4.0. Whether 10.1.A&B is on that list is UNCONFIRMED.
- Until the function secret `ENTSO_E_TOKEN` exists, the scheduled call returns `skipped` at once and reads nothing.

### Nord Pool urgent market messages (replay only)

- `https://ummapi.nordpoolgroup.com/messages/{id}/{version}`, public, no key. Fingrid published the Estlink 2 failure
  there: message `79210ee1-3395-4f75-a972-7b03888b107a`, version 2 at 11:01:34 UTC on 25 Dec 2024 (version 1 answers
  404), `eventStart` 10:26 UTC, reason "Failure", remarks "Estlink 2 trip", asset `Estlink 2` (`10T-FI-EE-00002O`).
  This is the REMIT publication that the ENTSO-E record carries too, so the replay uses it in place of the ENTSO-E
  record. It is in `src/lib/fault-signals/fixtures/nordpool-umm-estlink-2-v2.json`.
- The list endpoint `/messages?limit=50` also answers without a key, which would make a free live source for every
  Nordic and Baltic link. The site asks visitors to accept the "Nord Pool UMM Terms and Conditions", whose link is
  built by a script and was not read. Nothing polls UMM until those terms are read.

### Fingrid notice (replay only)

- "Fault in the EstLink 2 Electricity Transmission Connection Between Finland and Estonia Located in the Submarine
  Cable", published 26 Dec 2024 12:49 EET,
  https://www.fingrid.fi/en/news/news/2024/fault-in-the-estlink-2-electricity-transmission-connection-between-finland-and-estonia-located-in-the-submarine-cable/,
  saved verbatim in `scripts/fault-signals/fixtures/fingrid-estlink-2-notice.json`. archive.org had no snapshot on
  17 Oct 2026. One should be saved before the README cites it.
- The notice gives no minute, only that the link "disconnected from the grid after noon on Christmas Day". Finland was
  on EET (UTC+2), so the replay reads that as 10:00 to 22:00 UTC. `operator-notice.ts` refuses a reading whose quotes
  are not in the notice word for word.

## Matching

`cable-matcher.ts`, strongest basis first:

| Basis | Signal | Rule | Opens a draft |
| --- | --- | --- | --- |
| geometry | NGA trackline, area or points | within 5 km of a cable or pipeline route (`SIGNAL_NEAR_CABLE_METRES`); pipelines never match | yes |
| asset-name | power-link notice | the normalised name matches a power cable ("EstLink 2" and "HVDC Estlink 2" are both `estlink2`, Estlink 1 is not) | yes |
| border | power-link notice with the asset withheld | every power cable landing in both countries | yes |
| country | IODA | every telecom cable landing in the country | no, it joins one |

Landing countries live in `public.cable_landing_countries`, read from each seeded cable's name and the ends of its
route. A cable seeded later needs its rows there.

## Draft cases

For a match that opens a draft (`draft-case.ts`):

1. The window runs from 6 hours before the earliest moment the signal allows for the fault (the detector's lookback)
   to 15 minutes after the latest, cut to 96 hours.
2. The ships are those with a recorded position within 3 km of the cable in the window (the recorder keeps nothing
   farther). `public.fault_case_inputs` sends the window track of each ship that reported a speed in the 2 to 9 knot
   drag band, or no speed. Every other ship arrives as its closest position only. `splitShipsForDraft` is the same rule
   in TypeScript. The PGlite check below found the two equal.
3. The detector judges each track against the affected cable. The ranking runs in this order: a detection whose
   anchor path crosses the cable inside the fault span (the crossing's time band from the layback band, with 15 minutes
   of slack); a ship recorded at the cable inside the span whose track the detector cannot judge, because too few
   reports cannot clear it; a detection elsewhere or at another time; an unjudged track away from the fault time; a
   judged track with no drag signature; a ship never in the drag band; a working or small craft. Within a group the
   detector's own order (alert, score) comes first, then the closest approach, then the time from the fault.
4. At most 20 ships are kept and the rest are counted.

Several signals about one cable whose fault spans lie within a day of each other share one draft. The draft keeps the
ranking built from the tightest span (`isNarrowerFaultSpan`, applied in SQL by `public.store_fault_run`), because a trip
time to the minute says more about which ship was there than "after noon".

## Schedules

| Job | When | Body |
| --- | --- | --- |
| `match-fault-signals-nga` | `13 * * * *`, hourly | `{"sources": ["nga"]}` |
| `match-fault-signals-ioda` | `7,22,37,52 * * * *`, every 15 minutes, each reading the last 30 | `{"sources": ["ioda"]}` |
| `match-fault-signals-entsoe` | `43 * * * *`, hourly, skipped without `ENTSO_E_TOKEN` | `{"sources": ["entsoe"]}` |
| `prune-fault-signals` | `53 3 * * *`, daily | IODA signals that joined no draft in 7 days, and processed ids older than 30 days |

The minutes avoid the ship-frame collector (every 10 minutes from :00, about 110 s each) and the detector (:04, :34).
That is 4,320 function calls a month.

## Egress

Supabase counts every byte the database sends, and the free plan allows 5 GB a month. Sizes measured in PGlite 0.5.10
with PostGIS on the migrations of this branch:

| Call | Bytes | How often |
| --- | --- | --- |
| `unseen_fault_signal_ids` | under 1 kB | each call that fetched signals |
| `fault_match_inputs(false)` (names and countries) | 1,281 | each call with a new non-geometry signal |
| `fault_match_inputs(true)` (with the 16 routes) | 66,577 | each call with a new NGA warning |
| `fault_case_inputs`, replay ships, 6.25 h window | 18,382 | once per draft opened |
| `fault_case_inputs`, replay ships, 18.25 h window | 28,434 | once per draft opened |
| `recent_draft_cases`, 1 draft | about 1,720 | per page view (at most 20 drafts, about 35 kB) |
| `draft_case_detail`, 6 ships, 2 signals | about 5,690 | per draft opened in the UI (at most 20 ships) |
| `recent_fault_signals`, 2 signals | 1,187 | per page view (at most 50 signals, about 30 kB) |

The steady state is under 10 MB a month: 3,600 NGA and IODA calls of a few kB each. A draft on live traffic reads
more than the replay. `public.detection_inputs` measured 0.85 MB for 6 hours of every recorded cable on
17 Oct 2026, which bounds a 6-hour draft from above. A 96-hour NGA window could reach about 14 MB at that rate. NGA's
feed is frozen and matches nothing in the Baltic, so no such window opens today.

## The replay

`bun scripts/fault-signals/replay-known.ts`, from the repository root, ran on 17 Oct 2026 in 1.3 s with 17 of 17
expectations holding (exit 0):

- Fingrid's notice and Fingrid's market message each match HVDC Estlink 2 alone, by name.
- Market message (trip at 10:26 UTC, window 04:26 to 10:41 UTC, 6 ships within 3 km): Eagle S ranks first, recorded
  at the cable at the trip and unjudgeable. The slow coaster whose anchor path crossed at 09:29 follows, then the
  passers-by outside the drag band, then the tug. The far-lane decoy (8 km off) and the afternoon crossing are left out.
- Notice alone ("after noon", window 04:00 to 22:15 UTC, 7 ships): a decoy whose reconstructed anchor crosses the
  cable at 14:29 ranks first and Eagle S second. With only "after noon" to go on, a drag that crosses the cable
  at 14:29 is the stronger lead. The replay expects exactly that and says why in its output.
- Both records together form one draft, which keeps the market message's ranking, so Eagle S is first.
- NGA, 17 Oct 2026: the 14 kept and 12 dropped warnings equal the reading by hand, every trackline and area has the
  positions counted by hand, and no warning matches a registry cable. The nearest lies 1,418 km away.

The judge caught one design error before it passed. The first ranking put any detection above any undetected ship,
and a 6-knot coaster with a watch-level detection whose anchor crossed Estlink 2 an hour before the trip outranked
Eagle S. Investigators match the anchor path to the cut time, so the ranking now checks whether the crossing falls
inside the fault span.

What the replay cannot prove: Eagle S has no surviving AIS. The case file places its three positions on the cables at
the fault times from written statements (`src/data/cases/eagle-s-2024.ts`), so its rank comes from those placements, and
the detector can only call its track insufficient. The decoys are made up, one report a minute, in
`scripts/fault-signals/decoy-ships.ts`.

## SQL checked in PGlite

A throwaway script (`.scratch/`, not committed) loaded every migration into PGlite 0.5.10 with PostGIS 3, with pg_cron,
pg_net, Vault and Storage stubbed. It recorded the replay's ships through `public.ingest_vessel_positions`, one batch a
minute, which stored 824 of 1,413 reports after stationary thinning. All of these held:

- every seeded cable has landing countries;
- the four jobs register and their commands run;
- `fault_case_inputs` splits ships exactly as `splitShipsForDraft` does, and its draft ranks Eagle S first;
- the market message opens a draft and the notice joins it without reranking. In the reverse order the notice opens
  it and the market message reranks it;
- a repeated run changes nothing;
- an IODA country match opens nothing, and a draft opened later on that cable picks it up;
- the anon role can call the three public functions and not `store_fault_run`, and the browser parsers read their output;
- the prune keeps every signal attached to a draft.
