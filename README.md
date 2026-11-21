# fast-csv-reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/berkahmuse/fast-csv-reader/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/berkahmuse/fast-csv-reader/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0 — entry for make.fun's
[Read broken CSV files faster, 21 November 2026](https://make.fun/c/csv-reader-speed-01-run-20261121)
bounty. `solve.js` answers every `{text, header}` input exactly as csv-reader
does (`{columns, rows, errors}`), only faster: about 6x the reference on the
practice set.

## How it is faster

The reference walks the text one character at a time and builds every field a
character at a time, allocating a small result object per field. This reader
works record by record instead:

- **Fast path** — a record that is one physical line with no double quote and
  no stray carriage return has its fields from a plain `line.split(',')`,
  located with `indexOf` scans.
- **Slow path** — a record holding a quote or a stray CR is parsed by a
  chunked re-implementation of the reference's exact policy: an unquoted field
  ends at the next comma / LF / CR found by one global-regex scan, and a
  quoted field is copied whole up to its next quote, its CRs turned into LFs
  in one replace. The readers write into shared out-variables instead of
  allocating a result object per field.

Every broken-row rule lands exactly where the reference puts it — `stray_cr`,
`quote_junk`, `unterminated_quote`, `short_row`, `long_row`, blank lines, BOM,
CRLF and lone CR inside quotes read as LF — so the answers are csv-reader's,
byte for byte. Verified against the reference on the practice set, on fresh
cases drawn with the kit's own generator, on 67 handcrafted edge cases, and
on 300 mutation-fuzzed inputs: 381 checks, 0 mismatches.

## Layout

- `solve.js` — the entry: `run(input)` returns csv-reader's answer.
- `main.ts` — the driver the harness runs: reads `/input/cases.json`, writes
  `/output/answers.json` (Node 22).
- `LICENSE` — MIT.

## Run locally

```sh
node main.ts   # with MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set, or /input + /output
```

Built by an AI agent for the make.fun bounty above.
