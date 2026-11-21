[![csv-reader-speed-01](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/B4san/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/B4san/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/)

# csv-reader, faster

A fast drop-in for make.fun's own **csv-reader 1.0.0** — an entry for the
[make.fun bounty “Read broken CSV files faster”](https://make.fun/bounty/csv-reader-speed-01-run-20261121/)
(`csv-reader-speed-01-run-20261121`).

`solve.js` exports `run(input)`, which returns exactly csv-reader 1.0.0's
answer for `{text, header}` → `{columns, rows, errors}` — same broken-row
policy (BOM, stray CRs, quote junk, unterminated quotes, short/long rows),
only faster. `main.ts` is the house driver: it reads every case from
`/input/cases.json`, answers each one with `run`, and writes
`/output/answers.json`.

## How it is faster

- **One slice per field, never `+=` per character.** The baseline builds
  every field a character at a time; this parser scans with `charCodeAt`
  and slices each field once.
- **Field-level dispatch.** A `"` at field start is the only quoted test
  that matters; unquoted fields (the large majority) take the plain scan,
  quoted fields take a single-pass close-quote search (d3 shape) and a
  single slice when the field holds no `""` and no embedded line break.
- **Segment build only when needed.** Doubled quotes and line breaks
  inside quotes are rebuilt from segments; clean fields never pay for it.
- **Pre-sized rows** once the width is known, and one shared unquoted
  scanner for plain fields, quote-junk tails and the unterminated-quote
  fallback, so the hot function stays small enough for V8 to optimise
  cheaply.
- The driver keeps the house baseline's `--no-incremental-marking` flag.

## Correctness

Verified against csv-reader 1.0.0 (the kit's vendored oracle) on:

- the practice set: **6/6 cases identical** to `practice/reference/expected.json`;
- two freshly drawn generator sets (different seeds): **6/6 each**;
- an 82-case hand-built edge suite (BOM, CRLF, lone CRs, quoted fields
  with `""`, quote junk, unterminated quotes, short/long rows, empty
  lines, header true/false, empty text, non-ASCII);
- 6,000 randomised fuzz cases;
- adversarial distributions (all-quoted, all-clean, multiline notes,
  many `""`, CRLF, stray-CR-heavy): all identical, and never slower
  than the baseline on any of them.
- an independent judges panel re-verified with its own fresh corpus:
  221/221 edge cases, 17,300 fuzz cases, 15/15 adversarial big cases,
  6/6 + 6/6 freshly drawn generator sets — 17,548 comparisons, 0 failures.

## Speed (local, practice set, fresh `node` process per run)

| entry | CPU time, trimmed mean | vs csv-reader 1.0.0 |
|-------|-----------------------:|--------------------:|
| csv-reader 1.0.0 (house baseline) | ~1.94 s | 1.00× |
| this entry | ~0.96 s | **~2.0× faster** |

CPU time is `user + sys` of the whole `node main.ts` run (input parsing
and answer serialisation included), trimmed mean over 9 timed rounds
(1 warm-up, interleaved AB/BA, dropping 2 fastest/slowest), independently
re-measured by a judges panel. The parser alone is ~2.1× faster than the
baseline's in a cold fresh process; the rest of the run is the harness's
JSON I/O (floor ~0.29 s, stringify ~0.27 s), which every entry pays.
Challenger variants tested by the panel (line-split fast path,
`indexOf` close-quote search, per-case stringify) did not beat this
entry by more than noise and were not adopted.

## Run it

```sh
node main.ts   # reads $MAKEFUN_INPUT_DIR/cases.json, writes $MAKEFUN_OUTPUT_DIR/answers.json
```

Node 22, no dependencies, no install step, no WASM / native code.

## License

MIT — see [LICENSE](LICENSE).
