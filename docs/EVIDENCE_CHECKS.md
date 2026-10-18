# Evidence checks

Four scripts check that a case's evidence holds up and that the console shows all of it: the sources still answer,
nothing is buried more than two interactions deep, every layer works from the keyboard, and a shared link reopens
the same moment. Each one exits 0 when everything passes, 1 when a check fails, and 2 when the run itself could not
happen (no network, no browser, a page that never loaded), so a script or CI step can tell a finding from a broken
run.

The static rules (ids, archive addresses, capture dates) live in `findCaseProblems` in `src/lib/cases/case-file.ts`
and run with `bun test src`. The scripts below add what needs the network or a browser.

## The checks

| Script | What it proves | Run |
| --- | --- | --- |
| `scripts/cases/check-sources.ts` | Every source of every case resolves, and so does its archived copy | `bun scripts/cases/check-sources.ts` |
| `scripts/checks/evidence-reach.ts` | Every source, quote, translation, placement note, aftermath step, scale sentence and data credit is on screen within two interactions of the console's first state | `bun scripts/checks/evidence-reach.ts <baseUrl>` |
| `scripts/checks/keyboard-path.ts` | Each layer opens with Tab and Enter, takes focus, closes on Esc and gives focus back to its opener | `bun scripts/checks/keyboard-path.ts <baseUrl>` |
| `scripts/checks/deep-links.ts` | A link with `t`, `view`, `mode` and `layer` reopens that moment, view, mode and card; Back closes the last card opened | `bun scripts/checks/deep-links.ts <baseUrl>` |

Each also runs as a package script: `bun run check:sources`, `bun run check:evidence <baseUrl>`,
`bun run check:keyboard <baseUrl>` and `bun run check:links <baseUrl>`.

`<baseUrl>` is `https://cabletrace.vercel.app` or a local build (`bun run build && bun run start -p 3102`, then
`http://localhost:3102`). The three browser checks take `--case <slug>` to check one case, `--viewport 390x844` for
another screen size (1440x900 by default) and `--chromium <path>` (or `PERF_CHROMIUM_PATH`) for the browser, which is
found the same way as for `bun run perf` (`scripts/perf/chromium-path.ts`). `evidence-reach.ts` also takes
`--workers <1-8>`, the pages it drives at once (3 by default).

### Sources

`check-sources.ts` resolves each original address and each archived copy: HEAD first, GET when HEAD is refused or
fails (many servers mishandle HEAD), redirects followed, 20 s per request, at most 4 requests in flight, with the
User-Agent `CableTrace source check (+https://github.com/Andy00L/cabletrace)`. A page cited by two cases is fetched
once.

- **Fails** when a source has no archived copy (unless it is one of the 8 in `UNARCHIVABLE_SOURCES`, below), or its archived copy does not answer 2xx (a Wayback capture of a
  404 replays as 404), or redirects out of the archive. A dead original therefore always has a live archive behind it.
  The Wayback Machine sometimes answers 429 when read fast; a refused archive is asked again after 15 s and 45 s.
- **Listed apart:** originals that refuse automated readers (401, 403, 429; a browser usually opens them) and
  originals that no longer answer but whose archive does.
- **Exit 2** when `https://web.archive.org/` itself does not answer (no network).
- **No archive by decision:** `UNARCHIVABLE_SOURCES` in the script lists 8 sources that cannot be archived, each with
  its reason: four Danish Maritime Authority AIS zips (554 MB to 17.2 GB), Svalbard's Kystverket API query (a POST,
  which answers a bare GET with 405), and three U.S. Central Command pages, which Save Page Now refused with 520. They
  are listed on every run and still fail if their original stops answering, since the original is all a reader has.

`findCaseProblems` adds the rules that need no network: no source id twice in a case; an archived copy is a dated
snapshot (`https://web.archive.org/web/<YYYYMMDDhhmmss>/<page>`, or archive.today as `https://archive.ph/<id>` or
`.../<YYYY.MM.DD-hhmmss>/<page>`, on any of its domains); the snapshot is of the cited page (scheme, `www.`, a
trailing slash and the `#fragment` aside); and it was taken no earlier than the page's `publishedOn` (one day of slack
for time zones). A capture older than the page cannot hold what the case quotes from it.

### Evidence within two interactions

The list of what must be reachable comes from the case data, not from the page: each source's title, its link and
its archived link (as `href`s of visible links), every quote and every translation wherever they are cited, each
placed position's and each cut's placement note, the recorded track's selection note, each aftermath step, the three
scale sentences (`src/lib/seabed/scene-scales.ts`) and the data credits (depth, cables and pipelines from the case's
seabed file, the Copernicus land notice and liability line).

An interaction is one click on a visible control that nothing covers, or one console shortcut key (`?`, `1` to `4`,
`F`, Space, the arrows). Controls behind a modal layer (aria-hidden) do not count, links are read rather than
clicked, and the controls that only move the camera, the clipboard or the window are skipped (Copy link, Reset the
view, Full screen, Leave full screen). Text counts when it is rendered: inside a panel that scrolls counts, inside a closed `<details>`
does not.

The search is breadth first: the first state, then every single interaction, then two interactions, starting with
the controls the first one revealed (a card's source numbers, a sheet's rows) and going on to every other control
only while something is still missing. It stops as soon as everything has been seen. States after one interaction
that have the same address (apart from `t`) and the same controls as an earlier one are not explored again; this can
only under-count, never report something as reachable that is not. Between paths the console is put back in its
first state in place (Esc, the case's own address through `popstate`, the island, the rail and playing set back) and
compared word for word with the first state; when anything differs, the page reloads.

A run reports, per case, how many items it saw on the first screen, after one interaction and after two, and lists
every item it could not reach. A missing item is a finding to read, not proof the item is lost: the list says what
needs three or more interactions today.

### Keyboard path

For each layer (vessel card, cut card, source card, placement card, sources sheet, aftermath dialog, shortcuts) the
check loads the console fresh and presses only Tab and Enter: Tab until the opening control has focus (the Evidence
mode button first for the placement card, the sources sheet and the aftermath dialog), Enter. Then it checks the
layer is on screen with focus inside it, presses Esc, checks the layer is gone, and waits up to 2 s for focus to come
back to the very element that opened it. On a phone the rail's controls sit in the folded case panel, which the
check opens with the keyboard first. The report gives the key presses each layer took.

### Deep links

For each case the check builds links from the case's own data and its codec (`src/lib/console/console-state.ts`):
the first cut's card at the cut's minute in the close-up and Evidence mode, the vessel card in the Vessel view and
Ship mode, the sources sheet from above at the window's end, the shortcuts at the window's start, a source card, the
last placed position's card, the aftermath dialog, and one link of values the codec must reject (`t=yesterday`,
`view=sideways`, `mode=cinema`, `layer=cut-nowhere`, which must open the defaults). For each it compares the clock,
the pressed view and mode buttons, the open layer and a line of its content, and the address read back through the
codec, with the state the link encodes.

Back: it opens the vessel card from the ship's name, presses Back and expects the card closed, no `layer` in the
address and the console still open; then opens the vessel card and the first cut's card from the timeline (which
replaces the history entry) and expects one Back to close the cut card.

### What the browser checks change

All three load the console in headless Chromium with the software renderer (`--use-angle=swiftshader
--enable-unsafe-swiftshader`), wait for the 3D view to finish loading the seabed (`seabed-view` leaves
`data-state="loading"`), and switch off CSS animations and transitions. A busy machine can starve the software
renderer's frames for seconds, and Radix keeps a closing layer in the page until its exit animation ends, so with
animations on a check would measure the machine. They check reachability and focus, not motion. Clicks in
`evidence-reach.ts` hit-test the control's centre in the page, then click there with the mouse; Playwright's own click
also waits for two still animation frames, which the software renderer can starve the same way.

## Last results

Recorded on 2026-10-17 on one WSL2 machine (8 cores) shared with other jobs (load average 6 to 20), headless Chrome
for Testing from the Playwright cache, 1440 x 900 unless stated. "Local" is a production build of this branch at
commit `a465df1` (`bun run build`, `bun run start -p 3102`); "live" is https://cabletrace.vercel.app the same day.
Rerun before relying on any of these.

### Sources (`check-sources.ts`, exit 0)

After the lead's fixes (main `902475e` plus this branch): 127 sources in 10 cases, 119 with an archived copy, all 119
live. Originals: 102 live, 24 refuse automated readers (403 from poliisi.fi, raja.fi, valtioneuvosto.fi,
verkkouutiset.fi and centcom.mil; they open in a browser), 1 answers 405 by design (Svalbard's API query). The 8
sources without an archive are the `UNARCHIVABLE_SOURCES` list, all with their original answering. 115 s.

The first run (exit 1) found 9 sources failing. Two were fixed in the data: Yi Peng 3 source 10 had moved to
`.../aisdata.ais.dk/2024/aisdk-2024-11-18.zip` (the old address answered 404); Eagle S source 15 now cites the Nord Pool
message itself (`ummapi.nordpoolgroup.com`, archived as `20261017160918`, which holds
`"eventStart":"2024-12-25T10:26:00.0000000Z"`), because the old archive was a 2017 capture of the site's home page.
The other 7 became the unarchivable list.

### Evidence within two interactions (`evidence-reach.ts`, exit 0 after the fixes)

Local production build of main `c9b9024`, all 10 cases, `--workers 2`, 18 Oct 2026: 976 of 976 items reachable in
two interactions or fewer.

| Case | Reachable | After one interaction, after two | Paths tried |
| --- | --- | --- | --- |
| Hai Hong Gong 66 | 44 of 44 | 35, 9 | 239 |
| Fitburg | 156 of 156 | 77, 79 | 425 |
| Minlianyu 60138 | 52 of 52 | 47, 5 | 262 |
| Hong Tai 58 | 75 of 75 | 35, 40 | 277 |
| Vezhen | 134 of 134 | 74, 60 | 313 |
| Eagle S | 110 of 110 | 58, 52 | 350 |
| Yi Peng 3 | 86 of 86 | 53, 33 | 301 |
| Rubymar | 96 of 96 | 57, 39 | 330 |
| Newnew Polar Bear | 130 of 130 | 45, 85 | 259 |
| Svalbard | 93 of 93 | 50, 43 | 247 |

The first run (six cases, before the fixes) missed 85 items, in three patterns, each now fixed:

- A source cited only inside a layer that itself takes two interactions (mostly What followed: court rulings, charges
  and recovery) had its links and quotes three away. The sources sheet now keeps each source's links visible under
  its row, and each step of What followed shows its quotes.
- The drag window's own quotes (Eagle S source 10) showed only inside a folded sources row. The anchor status pill
  now opens onto "How the drag is known" with them.
- The measured close-up sentence needed the close-up, Measured, then the scale button. At the cut, the scale popover
  now gives both sentences.

### Keyboard path (`keyboard-path.ts`, exit 0 after the fix)

The first run (live, all 10 cases at 1440 x 900 and Eagle S at 390 x 844) passed the vessel, cut, source and
placement cards in every case (19 to 55 key presses) and failed the sources sheet, the aftermath dialog and the
shortcuts dialog in every case: Esc closed them, but focus landed on the page body. Radix returns focus to its own
Trigger, and those three layers open from controls that are not Triggers. `LayerSheet` now remembers the opener and
gives focus back to it, through the same hook as `LayerCard` (`src/components/ui/use-return-focus.ts`). Rerun on a
local build of the fix: Eagle S passes all 7 layers at 1440 x 900 (9 to 55 keys) and at 390 x 844 (6 to 31 keys).

### Deep links (`deep-links.ts`, exit 0)

Live: 89 of 89 checks pass over the 10 cases (8 links and the Back sequence per case; Svalbard has no placement link).
Local build: 72 of 72 over the first 8 cases.
One earlier local run failed the Vezhen placement link once because the card waits for the camera to frame its
position; the check now waits up to 8 s for a linked card to show, and the rerun passed.
