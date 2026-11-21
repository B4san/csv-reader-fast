# RESEARCH — fastest exact CSV parser in JS/Node 22
## Bounty: `csv-reader-speed-01-run-20261121`

- Date of research: 2026-11-21 (UTC). Deadline 2026-11-23T02:42:00Z.
- Prize: $100 total, $10 per place 1–10. A prize needs beating the house
  baseline (csv-reader 1.0.0) at 95% confidence (one-sided, over repeated
  timed runs). Only the 30 fastest correct entries reach the timing heat.
- Rule: `run(input)` must return **exactly** csv-reader 1.0.0's answer for
  `{text, header} -> {columns, rows, errors}` on every case. One wrong case
  = no timing, no prize. Speed is CPU time only, trimmed mean of 9 timed
  runs after 1 warm-up, in a fresh 1-CPU container, net of a do-nothing
  control; every run must write byte-identical outputs.
- Constraints: Node 22, `solve.js` + `main.ts`, dependency-free JS/TS only,
  nothing installed, **no WASM, no native addon, no prebuilt binary**.
  Repo max 1 MiB total. Transcripts NOT required for this bounty.
- Status of this file: research only. It does not change `solve.js` /
  `main.ts`. The builder should test every claim here before adopting it.

## 0. What the leaderboard does (and does not) tell us

- `GET /api/competitions/csv-reader-speed-01-run-20261121/leaderboard`
  and `?view=overall` both return, live on 2026-11-21 ~03:30 UTC:
  `metrics_withheld: true`, `entries: []`, `phase: dev`, `scores: live`.
  **Top times are NOT visible via the API while the dev phase runs.**
  The bounty page / Feed may show judged entries later, but there is no
  public time to chase right now.
- Submission count was 158 when the parent agent listed it, 160 a few
  minutes later — it is growing, but it is still the lowest-count serious
  code bounty open (tiny-chess 24k, token-radar 22k). The bar is not
  "beat a published time", it is "be in the top 10 of the fastest
  *correct* entries, and beat the baseline at 95%".
- There is **no earlier run of this exact slug** to learn from:
  `GET /api/competitions/csv-reader-speed-01/leaderboard` answers
  `{"success":false,"error":[{"message":"no competition csv-reader-speed-01"}]}`.
  The kit itself says "The next run: the first place's entry … is entered
  as the house baseline of this bounty’s next run" — so this run *is* the
  first, and the winner becomes next run's baseline. No public winner
  write-up exists yet.
- Closest analogue on make.fun: **"Make Markdown rendering faster"**
  (markdown-render-speed-02, $250, ended 2026-11-16). Its leaderboard
  shows the winning pattern for exactly this kind of "exact drop-in,
  less CPU" bounty:
  - 1st @icantcodefyi: "Cold-start tuned marked-exact renderer v3"
  - 2nd @ronigrv: "Hand-scanned marked 18.1.3, 2.8x faster"
  - 7th: "Own block, list and inline renderer with marked as the safety
    net: marked-exact HTML, 2x less CPU"
  - 8th: "Two-pass renderer … first-character dispatch and hand-written
    scanners, optimising compiler off and regexps compiled on first use"
  - A public entry (theyschool/markdown-render-speed-02, ~37% faster)
    describes the same recipe: two-pass design, sticky regexps /
    positional scans instead of repeatedly slicing strings, common paths
    that avoid building token objects they never need.
  - Lesson transferred here: **hand-written first-character dispatch +
    positional scans + no token objects on the common path + cold-start
    tuning** is what wins these bounties, not a clever library swap.
  - Sources: https://make.fun/bounty/markdown-render-speed-02/leaderboard
    and https://github.com/theyschool/markdown-render-speed-02

## 1. The actual workload (measured from the kit, not guessed)

Practice set: 6 cases, `practice/input/cases.json`, expected in
`practice/reference/expected.json` (`format: makefun/speed-home/expected/v1`).

| case | header | chars | lines | quotes | CRs | commas | rows | errors |
|------|--------|------:|------:|-------:|----:|-------:|-----:|-------:|
| g-0001 | true | 1,851,424 | 12,457 | 60,796 | 12,497 | 114,292 | 12,414 | 318 |
| g-0002 | true | 1,837,723 | 18,050 | 56,897 | 18,558 | 140,568 | 14,171 | 382 |
| g-0003 | false | 1,425,003 | 7,981 | 47,671 | 8,220 | 92,368 | 6,250 | 179 |
| g-0004 | true | 1,834,108 | 9,594 | 57,882 | 241 | 119,771 | 7,582 | 229 |
| g-0005 | true | 1,777,544 | 12,440 | 39,893 | 324 | 146,381 | 9,811 | 270 |
| g-0006 | false | 1,468,151 | 17,193 | 37,585 | 445 | 102,211 | 13,464 | 392 |

- Total per set: ~10.2 MB of CSV text, ~65k rows, ~780k fields.
  Mean field length 11–15 chars, max 56–60. Width 8–18 columns
  (9, 10, 14, 15, 15, 8 in the six practice cases).
- Error mix per case (the *only* thing that needs the slow path):
  short_row ~64–137, long_row ~56–143, quote_junk 30–73,
  stray_cr 26–58, unterminated_quote 0–1. Total errors ~180–390 per
  case, i.e. **~2–3% of rows are broken, ~97% are clean**.
- Generator (`program/generator/subject/csv-cases.mjs`, read in full):
  1.4–2.0M chars per file, 8–18 columns, column kinds int / decimal /
  date / code / word / phrase / note / maybe. Line break LF or CRLF
  per file, BOM on 1 file in 3, header on 2 files in 3.
  Broken-record chances per record after the header:
  short_row 1%, long_row 1%, stray_cr 0.4%, quote_junk 0.4%,
  blank_line 0.3%. On half the files, one quote near the end (last
  1–20 records) never closes, and the records after it hold no quote
  at all. Needless quoting 1% of plain fields. A `note` column is
  multiline 15% of the time (2–4 lines, line breaks are the file's
  own EOL, a lone CR now and then); a `phrase` holds a comma ~10% of
  the time and is then quoted, and 12% of phrases are written as
  `"phrase" word` (that is *not* quote_junk — the quote is inside the
  field value, see §3).
- **Decisive measurement — lines containing a quote: 63.5–85.7% of
  lines.** So a *row-level* fast path ("if the line has no quote,
  `split(',')` it") fires on only 15–35% of rows. A *field-level*
  fast path is mandatory: most rows have 1–3 quoted fields out of
  8–18, the rest plain. Any design that pays the quoted-field price
  for every field, or that checks the whole input for quotes once
  (PapaParse fastMode, §4), loses most of its advantage here.
- The scored set is drawn the same way from drand round 34199652,
  so these proportions will hold, ± sampling noise. Do not tune to
  the practice set's exact widths/contents; tune to the *distribution*.

## 2. Why the baseline is slow (what to beat)

Baseline = `baselines/csv-reader/vendor/csv-reader/index.js`
(`readCsv`), wrapped by `baselines/csv-reader/solve.js`. Its own
header says it plainly: *"written to be plain and easy to check, not
fast: one character at a time, each field built up a character at a
time."* Concrete costs, in order of size:

1. **Per-character string concatenation.** `value += c` for every
   character of every field — ~10M concatenations per set. Each one
   is a cons-string node in V8 (see §6); the flatten happens later,
   during `JSON.stringify` in `main.ts` and during comparisons.
   This alone is most of the 1.38 s the house measured.
2. **Per-character function/closure overhead.** `readUnquoted` /
   `readQuoted` are closures, `error()` is a closure, `at(i)` is a
   function call per `\r` check, `text[pos]` string indexing (not
   `charCodeAt`) on every character.
3. **No bulk operations at all.** No `indexOf`, no `slice` of a
   whole field, no `split`. Every delimiter is found by walking.
4. **No warm-up, no flag tuning in the baseline's own `main.ts`
   beyond `--no-incremental-marking`** (which it does set).

House-measured reference points (kit rules, on 10.2–11.8 MB sets,
gVisor, 1 CPU, rented box — same harness family as the grading):
csv-reader 1.0.0 **1.38 s CPU**; papaparse 5.7.1 **0.78 s**;
d3-dsv 3.0.2 csvParseRows **0.73 s**; csv-parser 3.2.1 **0.72 s**.
All three are ~1.8–1.9× faster than baseline *and all three fail
the gate* because they read broken rows their own way. So a correct
parser that merely matches d3's *technique* should already be
~1.9× faster; the fight for places 1–10 is among entries that all
do that, so the winner will be the one that squeezes the next
20–50% (field-level dispatch, allocation, JIT, stringify — §§5–7).

Current builder v1 (`csv-reader/solve.js`, 8,554 bytes) already
does the single biggest win: `charCodeAt` scan + `slice` each field
once, segment-slice for quoted fields, only stray CRs / doubled
quotes / embedded line breaks force extra segments. Its remaining
costs to attack (do not take my word for it — measure, §8):
- three near-duplicate unquoted scanners (plain field, quote-junk
  tail, unterminated fallback) — code size / icache, not CPU, but
  they share the same inner `while` that re-checks `44/10/13` per
  character; a single shared scanner may inline better;
- `value += text.slice(seg, i)` per segment — for a clean quoted
  field that is 1 slice + 0 concatenations, good; for a quoted field
  with `""` it is 2+ slices + concatenations;
- `fields.push`, `rows.push`, `errors.push` per field/row/error —
  unavoidable in shape, but see §5 for pre-sizing;
- `fields.splice(width)` for long_row allocates the `extra` array —
  required by the output, only ~100×/case, negligible;
- `main.ts` warm-up (current `main-v1-warmup.ts` / `main.ts`):
  10 iterations × 2 synthetic texts exercising every path. That
  warm-up runs *inside* the timed process, so it counts. 20 tiny
  runs are probably <5 ms, but verify 0 vs 3 vs 10 iterations —
  TurboFan needs only a few calls to optimise the hot function, and
  the first real case is 1.4 MB, so 1–2 warm-up passes may be enough.

## 3. Exact semantics — the parts that kill copy-paste parsers

Read the vendor source, not the summary. The divergences that
make papaparse / d3 / csv-parser fail the gate:

| case | csv-reader 1.0.0 | what the libraries do instead |
|------|------------------|-------------------------------|
| BOM | `U+FEFF` at the very start dropped, once | PapaParse strips BOM too, but d3 does not (it becomes part of the first field) |
| Empty line | no record at all | d3 emits `[]` / `[""]`; Papa skips only if configured |
| Lone CR outside quotes | dropped, error `stray_cr` (line/row of the record) | d3 treats `\r` as a line break; Papa treats it as data or a break depending on newline setting; csv-parser treats `\r` as line break |
| CRLF outside quotes | one line break | all handle, but line counting differs |
| Quoted field, `""` inside | one `"` | all handle |
| CRLF / lone CR *inside* quotes | each becomes one `\n`, line +1 | d3: CRLF inside quotes is kept as-is in the slice (it does not normalise); Papa: keeps the raw newline |
| Junk after closing quote (`"abc"kg`, `"a"x"y`) | appended as-is up to comma/EOL, error `quote_junk` *when the field ends* and only if `added > 0` | d3: junk is silently dropped / starts a new token; Papa: treats the field as unquoted from the quote onward, or errors "UnexpectedQuotes" |
| Unterminated quote | the `"` is a *literal* character, text after it re-read as unquoted, error `unterminated_quote`; the *rest of that record* is unquoted, the *next* record starts fresh | Papa: `MissingQuotes` error and aborts/ends parsing; d3: swallows to EOF as one field; csv-parser: state stays quoted to EOF |
| Quote inside an unquoted field (`O'Brien`, `say "hi"`) | literal character | Papa/d3 in unquoted mode: literal too — but their quoted detection is positional, so a `"` mid-field can flip them into quoted mode |
| short_row / long_row | pad with `""` / cut, error carries `fields: <count>` resp. `extra: <cut fields>`, line = line the record *starts* on, row = index in `rows` (null for header), in the order met | none of the three libraries emit these at all; they return ragged rows |
| Error `line` | 1-based line the record starts on, counting every LF, CRLF and lone CR *inside* quotes | libraries count lines differently or not at all |
| `columns` when header=true and file is empty / header only | `columns ?? []` (i.e. `[]` if no record at all) | libraries return `[]` or `null` inconsistently |
| Line holding only stray CRs | no record, but its `stray_cr` errors stay | libraries emit an empty row |

The generator guarantees every case holds short and long rows *by
the hundred*, so an entry that keeps ragged rows or drops the
`fields`/`extra` payload misses every case. The scorer compares
with canonical JSON (`scorer/main.ts`): strings code unit for code
unit, arrays in order, objects same keys any order. There is no
partial credit per field — a case passes or it does not.

## 4. What the fast libraries actually do (read from source)

Sources read: npm tarballs `d3-dsv-3.0.1`, `papaparse-5.5.3`
(house cites 5.7.1; the `Parser` core below is unchanged in the
relevant parts — re-verify against 5.7.1 before copying any line),
`csv-parser-3.2.1`, in `/tmp/research/`.

### 4.1 PapaParse 5.5.3 — `Parser` in `papaparse.js`

- **Fast mode (the whole trick):** `if (fastMode || (fastMode !==
  false && input.indexOf(quoteChar) === -1))` then
  `rows = input.split(newline)` and each row `row.split(delim)`.
  Both splits are native C++ builtins. LeanyLabs' benchmark found
  PapaParse fastest overall *and* faster than a hand-rolled
  `String.split` baseline, and "PapaParse was 2x slower with
  fast-mode disabled" on quoted data.
  https://leanylabs.com/blog/js-csv-parsers-benchmarks/
  **Transferable:** native `split` is the fastest way to cut
  clean data. **Not transferable as-is:** the gate `indexOf('"')
  === -1` never fires on this bounty (63–86% of lines have a
  quote), and `split(newline)` breaks multiline quoted fields.
  The transferable version is *per-row / per-field* fast mode (§7,
  architecture C), not per-input.
- **General mode:** three native searches per field —
  `nextDelim = input.indexOf(delim, cursor)`,
  `nextNewline = input.indexOf(newline, cursor)`,
  `quoteSearch = input.indexOf(quoteChar, cursor)` — then a loop
  that advances `quoteSearch` with `indexOf` until it finds a
  closing quote (skipping `""`), and recomputes delim/newline
  after it. Quoted value: `input.substring(cursor, quoteSearch)
  .replace(quoteCharRegex, quoteChar)` — one regex replace per
  quoted field (C++ regex, fast when there is nothing to replace,
  but it still scans the whole field).
  **Transferable:** `indexOf` from a cursor is V8's C++ `memchr`-
  like scan and beats a JS per-character loop for finding the
  *next* special character; using it for the closing quote
  (instead of walking char by char) is the single best quoted-field
  optimisation. **Not transferable:** the three-`indexOf`-per-field
  pattern re-scans the same stretch three times; the quoteSearch
  loop re-scans on every `""`; the regex replace allocates a new
  string even when there is no `""` to replace (guard it with a
  pre-check — see §7B).
- **What diverges:** newline is a single fixed string (`\n` by
  default); `\r` handling, `MissingQuotes` abort, no `stray_cr` /
  `quote_junk` / `short_row` / `long_row`, errors are `{type, code,
  message, row, index}` not `{code, line, row}`.

### 4.2 d3-dsv 3.0.2 — `token()` in `src/dsv.js`

- One function, numeric state (`QUOTE=34, NEWLINE=10, RETURN=13`),
  `charCodeAt` everywhere, `text.slice(j, i)` per token, quoted
  token: `text.slice(j+1, i-1).replace(/""/g, '"')`.
- Quoted scan is a single dense expression:
  `while (I++ < N && text.charCodeAt(I) !== QUOTE ||
  text.charCodeAt(++I) === QUOTE);`
  i.e. walk until a `"` that is *not* followed by another `"`.
  That is the fastest *correct-for-RFC4180* quoted scan in JS —
  no function calls, no `indexOf`, one comparison per char.
  **Transferable:** this exact loop shape, adapted so that `\r`
  / `\n` inside quotes are counted and normalised to `\n`
  (d3 does not normalise them; it also does not count lines).
- Unquoted scan: `while (I < N) { if ((c = text.charCodeAt(i =
  I++)) === NEWLINE) eol=true; else if (c === RETURN) …; else if
  (c !== DELIMITER) continue; return text.slice(j, i); }`
  **Transferable:** the "scan with charCodeAt, slice once" shape
  is exactly what builder v1 already does.
- **What diverges:** strips one trailing newline from the whole
  input (`if (text.charCodeAt(N-1) === NEWLINE) --N`), so a file
  ending without a newline vs with one is conflated; no BOM, no
  errors, no width normalisation, empty lines become rows, quoted
  junk is lost, unterminated quote swallows to EOF. Its
  `.replace(/""/g, '"')` on *every* quoted field is a cost to
  avoid when the field has no `""` (check first with
  `indexOf('""', …)` or track it during the scan — the scan already
  knows).

### 4.3 csv-parser 3.2.1 — `index.js` (Buffer-based, stream)

- Works on `Buffer`, not strings: `parseCell(buffer, start, end)`
  strips surrounding quotes, then compacts escapes **in place**
  (`buffer[y] = buffer[i]`, skipping the second `"` of `""`) and
  returns `buffer.slice(start, y)` / `toString`. **Transferable
  idea:** only pay for a copy when an escape actually occurs;
  otherwise return a zero-copy slice. In string-land the analogue
  is: slice once when the scan found no `""` / `\r` / `\n` inside
  the quotes, otherwise build from segments.
- `parseLine` scans bytes once with an `isQuoted` boolean toggle
  (`isStartingQuote / isEndingQuote / isEscape`), commas only
  split when `!isQuoted`. **Transferable:** a single boolean
  state machine is cheaper than a function call per field — but
  it is *wrong* for this bounty (a `"` mid-field must not toggle
  quoting; only a `"` at field start opens a quoted field, and
  junk after the closing quote must be appended, not treated as a
  new quoted section). Do not copy the toggle; copy the
  "one scan, no per-field function call" shape.
- **Not transferable:** it is a `Transform` stream (objectMode,
  per-row `writeRow`, header mapping callbacks, `mapHeaders` /
  `mapValues` per cell). That per-row/per-cell callback overhead
  is why the house measured it at 0.72 s despite the fast cell
  code — and it is also why it cannot be dropped in: it emits
  objects keyed by header, not `{columns, rows, errors}`.

### 4.4 Native parsers — ceiling, not a route

- Rust `csv` crate / `xsv`: "counts every record of a 1,000,000-row
  CSV at 413.76 MB/s" (`xsv` BENCHMARKS.md, via the kit rules);
  `qsv` indexes the 520 MB NYC 311 file (1M rows, 41 cols) in
  466 ms. https://github.com/BurntSushi/xsv
- `zsv`: SIMD fast parser, "branchless prefix-XOR carry
  propagation for quote state tracking" (NEON / AVX2 / SSE2).
  TurboCSV (Zig, SIMD): "Fast Mode 177 MB/s, 1.79× faster than
  PapaParse, 6.32× faster than csv-parse" on clean data.
  https://bytebrujo.github.io/bun-csv/
- HugeCSV (C → WASM): "2.3× faster than the same logic in
  JavaScript", and its chunking trick — parse every chunk under
  *both* hypotheses (starts inside / outside a quote) and pick
  the survivor when stitching — is the right idea for parallel
  parsing. https://hugecsv.com/learning-parser-wasm.html
- **All of this is forbidden here** (no WASM / native / prebuilt).
  The JS-usable residue is: (a) V8's native `indexOf` /
  `split` / regex are the only "SIMD" available — they run in C++;
  (b) the fastest JS parser will be the one that spends the most
  time inside those C++ builtins and the least time in JS per
  character; (c) quote-state tracking must be branch-cheap, not
  branchless — a single numeric state variable, no closures.

## 5. Sub-problems, each with its answer

### (a) Finding the next delimiter / newline — indexOf vs charCodeAt vs regex vs split

- `indexOf(char, from)` in V8 is a C++ scan (memchr-like, word-
  at-a-time on the underlying string). A JS `charCodeAt` loop
  costs ~1–3 ns/char in TurboFan; `indexOf` costs a fraction of
  that per char *when it can skip* — but it must be called once
  per *candidate*, and three `indexOf` calls per field (PapaParse)
  re-scan the same bytes three times.
- Best known shape for this data: **one** scan that finds the
  next of `, \n \r "` — either a tight `charCodeAt` loop (d3
  shape, 1 pass, no re-scan) or a single regex
  `/[",\r\n]/g` with `lastIndex` (V8 regex is C++ and can use
  specialised search; `exec` returns the index and the matched
  char). Which wins depends on field length: for 12-char fields
  the regex setup cost may exceed the loop; for 60-char note
  fields the regex wins. **Measure both (E3).**
- `split` is the fastest cutter *when the cut points are uniform*:
  `text.split('\n')` then `line.split(',')` beats any JS loop on
  clean rows (LeanyLabs: "Only scanning the data once while
  manually splitting everything can beat that" — i.e. split is
  the bar to beat). But it allocates an array of ~10–18k lines
  plus ~780k field strings up front, and it cannot handle
  multiline quoted fields. Use it only on provably clean spans
  (§7C).
- Regex `.replace(/""/g, '"')` on every quoted field: V8 compiles
  the regex once if it is a literal / hoisted; it still scans the
  field. Guard it: only call it when the scan already saw `""`.

### (b) Fast path vs slow path — per field, not per row, not per file

- Per-file fast path (PapaParse): dead here — every file has quotes.
- Per-row fast path: fires on 15–35% of rows. Worth having *if*
  it costs one `indexOf` check per row, not a full pre-scan.
  Implementation: after finding a row's end with `indexOf('\n')`,
  check `rowText.indexOf('"') === -1 && indexOf('\r') === -1`;
  if clean, `rowText.split(',')`. But finding the row end
  already requires knowing whether a `\n` is inside quotes —
  a `\n` inside a quoted note is *not* a row end. So the row
  fast path is only sound if you have already established the
  row contains no quote *before* its first `\n`… circular.
  Correct version: scan the row with the field loop; the field
  loop itself is the fast path (see below). Do not build a
  row-splitter that has to be undone for multiline notes.
- Per-field fast path (the one that matters): at field start,
  `charCodeAt(pos) === 34` ? quoted : unquoted. Unquoted fields
  are ~70–80% of fields: scan to the next `, \n \r` with the
  tight loop, slice once, done. Quoted fields: scan to the
  closing quote with the d3 loop, slice once if no `""` / `\r` /
  `\n` inside, else segment-join. This is builder v1's shape;
  keep it, and make the *unquoted* scan the most-optimised code
  in the file (it runs ~600k times per set).

### (c) String allocation — slice vs build, cons strings, sliced strings

- V8 strings: sequential (flat), **cons** (`a + b` = a node
  pointing at both halves, characters copied once on flatten),
  **sliced** (`slice`/`substring` ≥ ~13 chars = pointer to parent
  + offset + length, no copy). Sources:
  https://www.memory-management.com/javascript-memory-fundamentals-runtime-mechanics/object-shapes-strings-and-collection-memory-costs/why-string-concatenation-inflates-v8-heap-usage/
  and https://learn.sachinmaurya.com/javascript/strings-and-unicode/string-concatenation-ropes
- Consequences for this parser:
  - `slice` per field is *free* (no copy) while the parent text
    is alive — and the parent text is alive until the process
    exits anyway, because `answers` holds slices of it. So slicing
    is pure win vs `+=` per character.
  - The copy is paid **once**, at `JSON.stringify(answers)` in
    `main.ts` (flattening each slice). That stringify is inside
    the timed run and is the same for every entry — it is a floor,
    not a differentiator, *unless* an entry creates flat copies
    during parsing and then stringify copies them again (2 copies).
    Do not "detach" slices into flat strings to save memory:
    memory is not scored, CPU is, and the parent is retained
    regardless.
  - `value += slice` for a quoted field with one `""`: creates a
    cons node; flattening happens at stringify. 1–2 segments is
    fine. 5+ segments (a note with several `""` and embedded
    newlines) is rare — do not optimise for it.
  - Avoid `.trim()` / `.replace()` on the common path: they force
    V8 to materialise (flatten) cons/sliced strings.
    https://agentlefs.com/context/webpro/skills/skills/optimize-javascript/SKILL.md
  - Short fields (<13 chars) are copied by `slice` anyway — most
    fields here are 5–20 chars, so the sliced-vs-flat distinction
    barely matters for them; it matters for the 50–60 char notes.
- Object allocation: every field is a string (unavoidable),
  every row an array (unavoidable), every error an object
  (only ~300/case — negligible, but keep error objects to a
  single shape: always create `{code, line, row}` in that order
  and add `fields`/`extra` only on the short/long path; two
  shapes is fine, five shapes is not).

### (d) V8 optimisation — flags, shapes, monomorphism, deopts

- `--no-incremental-marking` is already set in `main.ts`
  *before* importing `solve.js`, and the house baseline does the
  same. The generator notes it saved ~0.4 s of wall on the draw
  process under gVisor, because the oracle's values are chains of
  joined strings and incremental marking walks them a step at a
  time. Keep it. Do not remove it to "test" — it is free.
- Other flags to *test* (each via `setFlagsFromString` in
  `main.ts`, before the import; the rules explicitly allow tuning
  V8 flags the same way): `--max-semi-space-size=32` (or 16/64)
  — young-gen size trades scavenge frequency against pause;
  with ~780k short-lived strings per set, a larger semi-space
  may cut scavenge count. `--single-generation` (no-op in newer
  V8 — verify it is accepted on Node 22, do not ship a flag that
  throws). `--no-opt` is the opposite of what we want.
  Measure with `node --trace-gc` / `perf_hooks` PerformanceObserver
  (`gc` entries) — see https://zeroexp.dev/library/node-gc-tuning
  for the measurement recipe. Expect ≤5% from flags; the parser
  loop is 90% of the time.
- Shapes / inline caches (from the optimise-javascript skill,
  https://agentlefs.com/context/webpro/skills/skills/optimize-javascript/SKILL.md):
  - one numeric state variable (`ended`: 0/1/2), never a string
    state (`'comma'` / `'line break'` — the baseline's strings
    force string comparison per field);
  - same property order on every error object; never `delete`;
  - homogeneous arrays: `rows` is `PACKED_ELEMENTS` (arrays of
    strings); `fields` likewise; do not mix numbers into them;
  - keep hot functions small so TurboFan inlines them; avoid
    closures that capture per-field state (the baseline's
    `readUnquoted`/`readQuoted`/`error`/`at` closures are a
    cost — builder v1 already inlined them into `run`, good);
  - keep parameter types stable: `run` is always called with
    `{text: string, header: boolean}` — do not call it with
    anything else in warm-up (the current warm-up uses the same
    shape, good);
  - `charCodeAt` out of bounds returns `NaN`, not an exception —
    guard `pos < n` before the call in the hot loop or the
    comparison becomes `NaN` handling and can deopt (Node's own
    querystring optimisation notes this exact pitfall:
    https://github.com/nodejs/node/pull/5012);
  - avoid `try/catch` on the hot path, avoid `arguments`, avoid
    spread in hot code, avoid megamorphic helpers (a helper called
    with many shapes goes megamorphic — keep the field scanners
    as straight-line code in `run`, not as a shared polymorphic
    helper, unless measurement says otherwise).

### (e) Error tracking, cheaply

- Errors are rare (~300/case, ~0.04% of fields). Anything that
  costs per-field to support errors is a bad trade; anything that
  costs per-error is free.
- `line` (the line the record starts on) is needed only when a
  record errors. But it must be *derivable* at error time.
  Current v1 maintains `line` incrementally (+1 per `\n` /
  CRLF, +1 per `\n`/`\r` inside quotes). That is 1 increment per
  record + 1 per embedded newline — cheap, keep it. Do NOT
  recompute it by scanning from the start (O(n²)).
- Cheaper variant worth testing (E7): do not maintain `line`
  during the unquoted scan at all — a record's line is
  `1 + (number of line breaks before it)`, and unquoted records
  consume exactly one line break each, so `line` can be derived
  from a counter of records + blank lines + quoted newlines.
  That is the same counter by another name; the saving is
  removing the increment from the *inner* unquoted loop (where
  the loop currently checks `c === 10` and increments). In
  practice the increment is one integer add per record, not per
  character — negligible. Do not chase this; chase (a)/(b).
- `recordRow` is `rows.length` (or null for the header) — free.
- `short_row`/`long_row` need `fields.length` at record end —
  free. `long_row`'s `extra` is `fields.splice(width)` — required
  output, ~100×/case.
- `stray_cr` / `quote_junk` / `unterminated_quote` are pushed at
  most a few dozen times per case. Their `errors.push({...})`
  cost is invisible. Do not optimise error objects; optimise
  the *detection* (i.e. do not add a branch per character to
  detect something that happens 40× per 1.8M chars — the branch
  itself is the cost, and it is already in the delimiter check).

### (f) Quoted fields without copying twice

- Clean quoted field (no `""`, no `\r`, no `\n` inside — the
  majority of quoted fields: a phrase with a comma, a needlessly
  quoted word): **one slice**, `text.slice(open+1, close)`,
  zero copies. This is the d3 shape and the v1 shape. Keep it.
- Field with `""`: the scan already knows where each `""` is.
  Options: (i) segment-slice + `+= '"'` per `""` (v1) — 1 slice
  per segment, cons nodes; (ii) single slice + one regex
  `.replace(/""/g, '"')` (d3) — C++ scan, one new string, but
  it re-scans the whole field; (iii) `split('""').join('"')` —
  allocates an array, worse. For fields with 1 `""`, (i) and
  (ii) are close; measure (E5). For 0 `""`, never call replace.
- Field with embedded `\n` / `\r`: each becomes `\n` in the
  output, so the output is *not* a slice of the input — it must
  be built. Segment-slice + `+= '\n'` per break (v1) is the
  right shape; the number of such fields is small (notes are
  ~1 column in 8–18, multiline 15% of the time → ~1% of fields).
- Quote-junk tail: after the closing quote, the tail up to the
  next `, \n \r` is appended *as it stands*. That is an unquoted
  scan starting at the closing quote — reuse the unquoted
  scanner, do not write a third copy of it (v1 has three copies;
  unifying them is E6).
- Unterminated quote: scan to EOF looking for a closing quote
  (one `indexOf` / one walk), then fall back to unquoted from
  `open+1` with a leading `'"'`. Cost is O(remaining text) once
  per file at most (generator: at most one per file, in the last
  1–20 records). Do not re-scan per field after it — the tail
  records hold no quotes, so the normal loop handles them.

### (g) Large input, memory / GC

- 1.4–2.0M chars per case, 6 cases per set, 1 CPU, 1024 MB.
  The input text is already a JS string (parsed from
  `cases.json` by `main.ts` — that `JSON.parse` is *also* inside
  the timed run, and is the same for every entry; do not try to
  avoid it, it is the harness's cost, net of the control only
  in the sense that the control does not parse).
- Output: ~65k rows × ~12 fields ≈ 780k strings + 65k arrays +
  6 answer objects. `JSON.stringify(answers)` then flattens
  every sliced string once. Total live heap at the end is the
  answers themselves (~10 MB of strings + overhead, roughly
  30–50 MB with array/object headers). Well under 1024 MB.
- GC pressure is the cost, not peak memory: ~780k short-lived
  strings (field slices that survive into `answers` are *not*
  short-lived — they survive to stringify, so they get promoted
  to old space; the short-lived garbage is the *intermediate*
  cons nodes, segment slices, and per-row `fields` arrays that
  are replaced). Minimise intermediates: 1 slice per field on
  the common path (already), no per-field object, no per-field
  array.
- Do not chunk the input: the harness gives you the whole text
  as one string, the output must be one JSON array, and chunking
  would add stitching logic for quoted fields spanning chunks
  (the HugeCSV two-hypothesis trick is for *parallel* workers;
  here there is 1 CPU and no workers — `worker_threads` would
  not help: 1 CPU, and the stitching cost exceeds the gain).
- Do not convert to `Buffer` / `Uint16Array`: `Buffer.from(text)`
  copies the whole text into UTF-8 (variable-length, so byte
  offsets ≠ char offsets, and non-ASCII words — Zürich, São
  Paulo, 東京, Δέλτα, Москва — become multi-byte), and then
  every field must be decoded back to a string. That is a copy
  *plus* a decode, for no benefit. Test once as a negative
  control (E8) and drop it.

## 6. V8 string / GC notes that change decisions

- `slice` ≥ ~13 chars = sliced string (parent + offset + len,
  no copy); short slices are copied. Most fields are 5–20 chars,
  so roughly half the fields are copied by `slice` anyway —
  that copy is a single `memcpy` in C++, far cheaper than a JS
  per-char loop. Do not fear `slice`.
- A sliced string keeps its parent alive. Here the parent (the
  1.4–2.0M-char case text) is alive until the process exits
  anyway (answers hold slices of it), so there is no memory
  penalty to slicing, and no benefit to "detaching" slices.
- Cons strings (`a + b`): cheap to create, flattened once on
  first use that needs contiguous characters (`JSON.stringify`,
  regex, comparison). A quoted field built from 2 segments is
  flattened once, at stringify. Fine.
- `--no-incremental-marking` (already set): turns incremental
  marking off, so marking happens in fewer, larger steps instead
  of being interleaved with the mutator. For a workload that
  allocates ~1M short-lived objects and then stringifies them,
  the house measured ~0.4 s saved on the *generator* under
  gVisor. Keep it, and re-verify it helps (not hurts) on this
  VM with an A/A test (E9) — incremental marking off can make
  individual GC pauses longer, but CPU time is what is scored,
  not pause length.
- `JSON.stringify` cost: the answers are ~10 MB of JSON. Every
  entry pays it. The only lever is *how many* strings there are
  (fixed by the output) and whether they are already flat (they
  are not — they are slices/cons). Nothing to do, except: do not
  build the answers as a string yourself (no manual
  `JSON.stringify` per row — that would flatten per row *and*
  again at the top level).

## 7. Five concrete architectures (benchmark in this order)

### A. Refined single-pass charCodeAt segment-slice (builder v1, improved)
- *What:* `run` is one function, numeric state, `charCodeAt`
  inner loops, slice-once per field, segment-join only for
  quoted fields with `""` / embedded breaks. Unify the three
  unquoted scanners into one. Keep `--no-incremental-marking`
  + warm-up.
- *Pros:* already written and (presumably) correct; smallest
  risk; every optimisation in §5 applies directly.
- *Cons:* JS loop still touches every character once (~10M
  charCodeAt calls per set). Ceiling ~2–2.5× baseline.
- *Benchmark first.* This is the baseline to beat for B–E.

### B. indexOf-driven field scanner ("PapaParse general mode, fixed")
- *What:* per field, compute `nextComma = text.indexOf(',', pos)`,
  `nextNL = text.indexOf('\n', pos)`, `nextCR = text.indexOf('\r', pos)`
  — but only the *nearest* matters, so compute them lazily:
  first `indexOf(',')` and `indexOf('\n')`; the smaller wins
  unless a `"` opens the field. For a quoted field, `close =
  text.indexOf('"', open+1)` in a loop that skips `""`
  (`if (text.charCodeAt(close+1) === 34) continue`); then check
  for `\r`/`\n` inside `[open+1, close)` with one
  `indexOf` each — if none, one slice; if some, segment-join.
- *Pros:* the long unquoted stretch is skipped by C++ `indexOf`
  instead of a JS loop; quoted closing-quote search is C++.
- *Cons:* 2–3 `indexOf` calls per field (~780k fields → ~2M
  native calls, each with call overhead); re-scans when the
  nearest delimiter is not the one that ends the field; for
  12-char fields the call overhead may exceed the loop saving.
- *Benchmark second.* This is the most likely winner *or* the
  most likely disappointment — the only way to know is E3.

### C. Clean-row split fast path (PapaParse fast mode, per row, guarded)
- *What:* find row boundaries with `indexOf('\n')`; for each
  candidate row span, if `span.indexOf('"') === -1 &&
  span.indexOf('\r') === -1`, parse it with `span.split(',')`
  (native). Otherwise fall back to the field loop for that row.
  Blank lines / CRLF / stray-CR rows go to the slow path.
- *Pros:* native `split` is the fastest cutter known for clean
  rows; 15–35% of rows are clean, and those rows are ~15–35%
  of the work.
- *Cons:* finding the row end safely requires knowing no quote
  is open — a `\n` inside a quoted note is not a row end, so
  the "row span" must be found by the field loop anyway, or by
  a pre-scan that costs as much as parsing. The guard
  `indexOf('"')` on the span is an extra scan. Net gain is
  uncertain and the correctness risk (multiline notes, CR-only
  line breaks inside quotes) is the highest of the five.
- *Benchmark third, as a variant of A:* only enable it when a
  row's first field is unquoted *and* the row's `\n` is found
  before any `"` — i.e. scan the row with the field loop but
  use `split(',')` for the *remainder* of the row once you know
  it is quote-free. That formulation is sound; the naive
  whole-row version is not.

### D. Single-regex tokeniser
- *What:* one hoisted regex `/[",\r\n]/g` (or
  `/[",\r\n]/y` sticky), `regex.lastIndex = pos`,
  `match = regex.exec(text)` gives the next special character
  and its index in C++. Dispatch on `match[0]`. Quoted fields:
  same regex finds the next `"`; check `""` by peeking.
- *Pros:* one C++ scan finds *any* special character — no
  triple `indexOf`, no JS per-char loop. The markdown-bounty
  winner's "sticky regexps and positional scans" is the same
  idea.
- *Cons:* `exec` allocates a match array + string per hit
  (~1M hits per set — that allocation may eat the saving);
  regex `lastIndex` state must be reset per case; V8 regex
  performance on a 2 MB string with `/g` is good but not free.
- *Benchmark fourth.* If it wins, it wins big; if the match
  allocation dominates, it loses clearly. Easy to test, easy
  to drop.

### E. Width-aware, pre-sized, unrolled row builder
- *What:* after the first record, `width` is known (8–18).
  Allocate `fields = new Array(width)` and fill by index
  (`fields[i] = slice`) instead of `push`; on short_row fill
  the tail with `''` in a small loop; on long_row, collect
  `extra` only for the fields past `width` (do not `splice`
  a grown array — build `extra` as you go). Unroll the
  first-field check (quoted vs not) out of the loop.
  Optionally: reuse a single `fields` scratch array per `run`
  call and `rows.push(fields.slice())` — no, that copies the
  array per row; `push` of a fresh array is cheaper. Do not
  reuse across rows.
- *Pros:* removes `push` growth checks and holey-array
  transitions; makes the row shape monomorphic.
- *Cons:* `new Array(width)` starts holey; if any slot is left
  unset (it will not be — every slot is filled or padded),
  V8 may keep it holey. Gain is small (array push is already
  fast). Only worth it *after* A/B/D are settled.
- *Benchmark last, as a delta on top of the winner.*

**Not recommended:** Buffer/Uint16Array conversion (E8, negative
control), `worker_threads` (1 CPU), WASM/native (forbidden),
copying papaparse/d3/csv-parser verbatim (fails the gate, §3),
a two-pass pre-index of all delimiters (stores ~1M positions,
memory + a second pass, no win over a single pass).

## 8. Prioritised experiments (builder's checklist)

Measurement protocol for *every* experiment (do not skip it —
the house timing is a trimmed mean over 9 rounds in a fresh
container, and local noise on a shared VM is real):
- Correctness first: `node cli/makefun.mjs grade-local --kit . --bot
  <repo> --driver process` (Node bot; Docker driver needs the
  harness image) **and** a direct diff against the oracle on the
  practice set (6/6 cases byte-identical as JSON values) **plus**
  a hand-built edge corpus (BOM, empty text, header-only, no
  trailing newline, CRLF file, lone-CR file, unterminated quote
  in the middle and at EOF, quote-junk variants `kg`, `x`, ` (est.)`,
  `x"y`, short/long rows, blank lines, a line of only stray CRs,
  quoted field that is exactly `""`, empty quoted field, field
  that is only `"`, non-ASCII words).
- Timing: fresh `node` process per variant, `--no-incremental-marking`
  (as `main.ts` sets it), `process.cpuUsage()` around the 6
  practice cases, 1 untimed warm-up round + 9 timed rounds,
  trimmed mean dropping the 2 fastest and 2 slowest (mirror the
  house), alternate AB/BA order across rounds, include an A/A
  control (same variant twice) to estimate noise. Report
  mean ± spread and speedup vs baseline, not a single run.
- Consume the result (e.g. hash / length-check the answers) so
  the JIT cannot eliminate the parse.

| # | Experiment | What to change | Success criterion |
|---|------------|----------------|-------------------|
| E1 | Baseline for everything | Time builder v1 + baseline `solve.js` on practice set with the protocol above | v1 is correct 6/6 and ≥1.5× baseline; record the number |
| E2 | Warm-up sweep | `main.ts` warm-up 0 / 1 / 3 / 10 iterations | Pick the smallest iteration count within noise of the best |
| E3 | Scanner shootout | Same parser, three inner scanners: (i) charCodeAt loop, (ii) triple-indexOf, (iii) single regex `/[",\r\n]/g` | Fastest correct scanner on practice set; keep it |
| E4 | Quoted-field variants | Clean quoted: 1 slice vs slice+replace; `""` field: segment-join vs slice+regex-replace vs `split('""').join('"')` | Fastest per sub-case; guard replace with a pre-check |
| E5 | Unify unquoted scanners | One shared unquoted scanner for plain fields, junk tails, unterminated fallback | No correctness change, time ≤ v1 (code-size / inline win) |
| E6 | Clean-row split (arch. C, sound form) | After a row is proven quote-free by the field loop, `split(',')` the remainder | Only adopt if >5% faster than A on practice set |
| E7 | Line-count deferral | Maintain `line` only via record count + quoted newlines, remove increment from inner loop | Adopt only if measurable (>2%) — expect negligible |
| E8 | Buffer conversion (negative control) | `Buffer.from(text)` + byte scan + decode | Expect slower; document and drop |
| E9 | V8 flags | `--max-semi-space-size=16/32/64`, `--no-incremental-marking` on/off, via `setFlagsFromString` before import | Adopt only if >3% and stable across 3 runs; verify flag is accepted on Node 22 |
| E10 | Pre-sized rows (arch. E) | `new Array(width)` + index fill vs `push` | Adopt only if measurable |
| E11 | Adversarial cases | Generate cases from `generator/draw.ts` with a different seed (if the kit allows) or hand-built: all-quoted file, all-clean file, many-multiline-notes file, many-`""` file | No variant wins on practice but loses on adversarial; the scored set is a fresh draw |
| E12 | Final grade-local | `grade-local --driver process` on the chosen variant, then `--driver docker` if Docker is available | Passes, and time is within noise of the local timing |

Order: E1 → E2 → E3 → E4 → E5 → E6/E7 → E9/E10 → E8 (any time,
as a control) → E11 → E12. Do not submit before E11: the scored
set is a fresh draw, and a variant tuned only to the practice
set's exact quote density can lose on the scored set.

## 9. Top 5 techniques (summary for the builder)

1. **Slice once per field, never `+=` per character.** The
   baseline's whole deficit is per-character concatenation.
   `charCodeAt` scan + `slice` is the 1.8–1.9× win by itself
   (house numbers: d3 0.73 s vs baseline 1.38 s).
2. **Field-level dispatch, not file- or row-level.** A `"` at
   field start is the only quoted test that matters; 63–86% of
   rows contain a quote, so row-level fast paths barely fire.
3. **Native search for the next special character.** `indexOf`
   (C++) for the closing quote and for delimiters, or a single
   hoisted regex — whichever wins E3. Never walk a long clean
   stretch in JS if a builtin can skip it.
4. **One slice for a clean quoted field; segment-join only when
   `""` / embedded breaks actually occur.** Guard every
   `.replace(/""/g, …)` with a pre-check; the scan already knows
   whether `""` was seen.
5. **Cold-start tuning is free performance.** Warm-up that
   exercises every path (already in `main.ts`, sweep it in E2)
   + `--no-incremental-marking` before import. The markdown
   bounty was won on exactly this ("cold-start tuned", "hand-
   scanned", "first-character dispatch").

Expected speedup: a correct implementation of 1–4 should land
at **~1.9–2.5× the baseline** (0.55–0.73 s on a practice-sized
set). The house's own numbers put d3 at 1.89× and csv-parser at
1.92× *while being wrong*; a correct parser that matches their
technique and adds field-level dispatch should be in that band.
Beating 2.5× would require winning E3 by a large margin (regex
or indexOf beating the charCodeAt loop by >20%) — possible, not
assumed. Anything below 1.5× means the scanner is still doing
per-character work somewhere it should not.

## 10. Biggest risks

1. **Correctness on the tail.** The unterminated-quote file
   (50% of files) is the easiest place to lose all 6 practice
   cases at once: after the fallback, the parser must *not*
   stay in quoted mode, and the tail records (no quotes) must
   parse as ordinary unquoted records. Test it explicitly.
2. **Line numbers.** `line` must count CRLF *and* lone CR
   inside quotes as one line each, and must *not* count a lone
   CR outside quotes (it is dropped, not a break). An off-by-one
   here fails every case that has a `stray_cr` before a later
   `short_row` in the same file — i.e. most cases.
3. **Quote-junk ordering.** `quote_junk` is pushed *when the
   field ends*, after any `stray_cr` inside the junk, and before
   the record's `short_row`/`long_row`. Error order is part of
   the compared JSON value.
4. **Over-tuning to the practice set.** The scored set is a fresh
   drand draw (round 34199652). Width, quote density, and the
   unterminated tail will differ. E11 is mandatory.
5. **Timing noise / false wins.** Local VM is shared (1.5 CPU
   shared in this environment; the grader is 1 CPU in gVisor).
   A 3% "win" on one run is noise. Use the protocol in §8 and
   the house's own 95%-confidence bar as the standard: if it is
   not significant locally, it will not be significant in the heat.
6. **JSON.stringify floor.** ~10 MB of answers must be
   stringified inside the timed run by every entry. Do not try
   to beat it by building JSON by hand — that flattens strings
   twice.
7. **Do not copy library code.** Papaparse (MIT), d3-dsv (ISC),
   csv-parser (MIT) are permissively licensed, but copying them
   verbatim (a) fails the gate (§3), (b) risks the
   `thinking_own_work` / duplicate-snapshot checks, and (c) is
   slower than a purpose-built parser for this exact semantics.
   Use them as *technique references* only, as this file does.

## Sources

- Kit (local): `csv-reader-speed-01-run-20261121-kit/` —
  `RULES.txt`, `baselines/csv-reader/vendor/csv-reader/index.js`,
  `baselines/csv-reader/main.ts`, `program/generator/subject/csv-cases.mjs`,
  `program/scorer/main.ts`, `practice/input/cases.json`,
  `practice/reference/expected.json`.
- House rules naming papaparse / d3-dsv / csv-parser / Rust csv /
  qsv timings: kit `RULES.txt` (same numbers in the bounty description).
- PapaParse 5.5.3 source (read from npm tarball):
  `papaparse.js`, `Parser` / fast mode. Upstream: https://github.com/mholt/PapaParse
- d3-dsv 3.0.1 source (read from npm tarball): `src/dsv.js`,
  `token()` / `parseRows`. Upstream: https://github.com/d3/d3-dsv
- csv-parser 3.2.1 source (read from npm tarball): `index.js`,
  `parseCell` / `parseLine`. Upstream: https://github.com/mafintosh/csv-parser
- LeanyLabs, "JavaScript CSV Parsers Comparison":
  https://leanylabs.com/blog/js-csv-parsers-benchmarks/
- OneSchema, "Top 5 Javascript CSV Parsers":
  https://www.oneschema.co/blog/top-5-javascript-csv-parsers
- webpro/skills, "optimize-javascript" (37 V8 rules):
  https://agentlefs.com/context/webpro/skills/skills/optimize-javascript/SKILL.md
- V8 string representations (cons / sliced / flatten):
  https://www.memory-management.com/javascript-memory-fundamentals-runtime-mechanics/object-shapes-strings-and-collection-memory-costs/why-string-concatenation-inflates-v8-heap-usage/
  and https://learn.sachinmaurya.com/javascript/strings-and-unicode/string-concatenation-ropes
- Node GC tuning / measuring GC with `perf_hooks`:
  https://zeroexp.dev/library/node-gc-tuning
- Node querystring optimisation (charCodeAt out-of-bounds /
  numeric state): https://github.com/nodejs/node/pull/5012
- TurboCSV (Zig/SIMD, Fast Mode 177 MB/s):
  https://bytebrujo.github.io/bun-csv/
- HugeCSV, "How we built a WebAssembly CSV parser" (two-hypothesis
  chunking, 2.3× vs JS): https://hugecsv.com/learning-parser-wasm.html
- xsv / Rust csv crate: https://github.com/BurntSushi/xsv
- make.fun, "Make Markdown rendering faster" leaderboard:
  https://make.fun/bounty/markdown-render-speed-02/leaderboard
- make.fun public entry, markdown-render-speed-02:
  https://github.com/theyschool/markdown-render-speed-02
- Leaderboard API (checked live 2026-11-21):
  `GET https://make.fun/api/competitions/csv-reader-speed-01-run-20261121/leaderboard`
  (and `?view=overall`) — `metrics_withheld: true`, `entries: []`.
