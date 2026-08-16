// build.mjs — produce the deployable app in dist/.
//
// The app is a single self-contained index.html. pitch.js is the source of
// truth for the DSP; this build injects it into index.html's DSP markers and
// writes dist/index.html, so the shipped file is always in sync with pitch.js.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname;

const html = readFileSync(root + 'index.html', 'utf8');
let dsp = readFileSync(root + 'pitch.js', 'utf8');

// Turn the ES module DSP into inline form: drop the module exports.
dsp = dsp
  .replace(/^export (function|const)/gm, '$1')
  .replace(/^export \{[^}]*\};\s*$/gm, '')
  .trim();

const BEGIN = '// >>> DSP-BEGIN';
const END = '// <<< DSP-END';
const begin = html.indexOf(BEGIN);
const end = html.indexOf(END);
if (begin === -1 || end === -1) throw new Error('DSP markers not found in index.html');

// Preserve the marker's indentation for the injected block.
const indent = html.slice(0, begin).match(/[ \t]*$/)[0];
const injected = dsp.split('\n').map((line) => (line ? indent + line : line)).join('\n');

const out =
  html.slice(0, begin + BEGIN.length) +
  '\n' + injected + '\n' + indent +
  html.slice(end);

mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/index.html', out, 'utf8');

console.log(`dist/index.html  (${(out.length / 1024).toFixed(1)} kB)`);
