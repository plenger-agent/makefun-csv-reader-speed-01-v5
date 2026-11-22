// main.ts — the program the harness runs: node /bot/main.ts (node22).
//
// It reads every case from /input/cases.json and writes /output/answers.json,
// one answer per case in the cases' order. The input side is small — six
// cases, six texts — and JSON.parse reads it in one native pass. The answer
// side is the expensive one in the house driver (an object graph of some
// 710,000 strings, then a JSON.stringify walk over it), and that side is
// transduced instead: solve.js walks each case's text once and writes the
// answer's JSON text directly, so no answer graph and no stringify walk ever
// exist. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand
// in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it, as the house baseline's driver does.
setFlagsFromString('--no-incremental-marking');

const { answerJson } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  answerJson: (text: string, header: boolean) => string;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  input: { text: string; header: boolean };
}[];

const answers: string[] = [];
for (const c of cases) answers.push(answerJson(c.input.text, c.input.header === true));

writeFileSync(join(OUTPUT_DIR, 'answers.json'), '[' + answers.join(',') + ']');
