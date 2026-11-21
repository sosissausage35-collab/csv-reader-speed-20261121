# csv-reader-speed-20261121

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/sosissausage35-collab/csv-reader-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/sosissausage35-collab/csv-reader-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0 — an entry for the
[make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## What it does

`solve.js` exports `run(input)`, which reads one case's input `{text, header}`
and returns exactly the answer csv-reader 1.0.0 returns: `{columns, rows, errors}` —
the header (or `null`), every other record as an array of strings at the first
record's width, and a record of every broken thing met (stray CRs, unterminated
quotes, quote junk, short and long rows). `main.ts` is the program the harness
runs: it reads every case from `/input/cases.json`, answers each with `run`,
and writes `/output/answers.json`.

## How it is fast

The reference walks the text one character at a time and builds every field by
appending one character at a time. This reader instead finds field boundaries
with native `indexOf` scans and takes whole fields out with `slice`:

- A record whose first line holds no quote and no stray CR is split in one
  `String.split(',')` call.
- Otherwise each field is cut out between the next `,` or line break; a CR
  inside an unquoted field can only be a stray one, so it is stripped from the
  cut-out slice instead of ending the field.
- A quoted field is found with `indexOf('"')` (skipping doubled quotes), its
  body taken as one slice, `""` collapsed with `replaceAll` and CR/CRLF folded
  to LF with one replace; line numbers inside it are counted with scans bounded
  to that slice.
- Field results are written into one reused holder instead of allocating a
  result object per field.

## Verification

On the kit's practice set (6 cases, ~10 MB of CSV) the entry's output is
byte-identical to the house baseline's, the kit scorer reports
`passed: 1, cases_passed: 6/6`, two runs produce byte-identical output, and it
also passes 6/6 on three freshly drawn sets from the kit's generator plus 68
hand-written edge cases checked against the reference.

Local CPU time on the practice set (this machine): the parser runs in ~335 ms
against the reference's ~1250 ms; end to end ~1.34 s against the baseline's
~2.51 s.

## Run it

```sh
node main.ts
```

Node 22 or later. No dependencies, no network, no build step.

## License

MIT — see [LICENSE](LICENSE).

Built with [make.fun](https://make.fun/r/f4pc3mbd).
