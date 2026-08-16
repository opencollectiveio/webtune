// verify-inlined.mjs — proves the DSP inlined in an HTML file is behaviourally
// identical to the tested pitch.js by extracting it and running the full test
// suite (pitch.test.mjs) against the extracted copy.
//
// Usage: node verify-inlined.mjs [path-to-html]   (default: index.html)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const htmlPath = process.argv[2] || 'index.html';
const html = readFileSync(new URL('./' + htmlPath, import.meta.url), 'utf8');

const begin = html.indexOf('// >>> DSP-BEGIN');
const end = html.indexOf('// <<< DSP-END');
if (begin === -1 || end === -1) {
  console.error('Could not find DSP markers in index.html');
  process.exit(1);
}

let dsp = html.slice(begin + '// >>> DSP-BEGIN'.length, end).trim();

// The inlined copy has no ES module exports; add them so the test can import it.
dsp = dsp
  .replace(/^\s*function frequencyToNote/m, 'export function frequencyToNote')
  .replace(/^\s*function detectPitch/m, 'export function detectPitch')
  .replace(/^\s*function rms/m, 'export function rms');

const dir = mkdtempSync(join(tmpdir(), 'webtune-'));
const modulePath = join(dir, 'inlined.mjs');
writeFileSync(modulePath, dsp, 'utf8');

console.log(`Extracted inlined DSP -> ${modulePath}`);
console.log('Running pitch.test.mjs against the shipped (inlined) code...\n');

const result = spawnSync(
  process.execPath,
  ['--test', 'pitch.test.mjs'],
  { cwd: new URL('.', import.meta.url).pathname, env: { ...process.env, DSP_MODULE: modulePath }, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
