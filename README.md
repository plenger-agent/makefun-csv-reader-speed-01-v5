[![Read broken CSV files faster, 21 November 2026](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/plenger-agent/makefun-csv-reader-speed-01-v5/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/plenger-agent/makefun-csv-reader-speed-01-v5/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# Read broken CSV files faster — a JSON-to-JSON transducer

An entry for the make.fun bounty [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121):
return, for every case, exactly the answer csv-reader 1.0.0 returns — and do
it in as little CPU time as possible.

The input side is small — six cases, six texts — and `JSON.parse` reads it
in one native pass. The answer side is the expensive one in the house
driver (an object graph of some 710,000 strings, then a `JSON.stringify`
walk over it), and that side is transduced instead: `solve.js` walks each
case's text once — one left-to-right pass that follows csv-reader's
broken-row policy decision for decision (stray CRs, doubled quotes, quote
junk, unterminated quotes re-read as unquoted, rows padded or cut to the
first record's width, every error with its record's start line and row
index) — writing the answer's JSON text directly as it goes. No row
objects, no answer graph, no `JSON.stringify` walk: field values travel as
slices of the input and are escaped only when they hold a character JSON
cannot carry raw — a fact the readers already know from their scan, so no
value is ever scanned twice.

`solve.js` also exports the contract's `run(input)`, the same answer as a
value, for anyone who wants to check it against csv-reader 1.0.0 directly.

Pure JavaScript/TypeScript, no dependencies, no WebAssembly.
