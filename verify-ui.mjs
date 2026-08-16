// verify-ui.mjs — end-to-end verification of the tuner UI.
//
// Serves the folder, launches headless Chrome, and drives the REAL page over
// the DevTools Protocol. The only stub is navigator.mediaDevices.getUserMedia,
// replaced with an OscillatorNode-backed MediaStream at known frequencies —
// the software equivalent of Chrome's fake-audio flags (which don't feed audio
// on macOS). Everything downstream (AudioContext, AnalyserNode, detectPitch,
// and all UI rendering) is the shipped code.
//
// Usage: node verify-ui.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8137;
const DBG = 9380;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal CDP client over Node's built-in WebSocket ---
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && this.handlers.has(m.method)) this.handlers.get(m.method)(m.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) { this.handlers.set(method, fn); }
}

const evalJS = (cdp, expression, awaitPromise = false) =>
  cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }).then((r) => r.result.value);

const OVERRIDE = `
  window.__testFreq = 440;
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = window.__testAC || (window.__testAC = new (window.AudioContext || window.webkitAudioContext)());
    await ac.resume();
    const osc = ac.createOscillator();
    osc.type = 'sine'; osc.frequency.value = window.__testFreq;
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest); osc.start();
    return dest.stream;
  };
  'ok';`;

const readDom = (cdp) => evalJS(cdp, `JSON.stringify({
  letter: document.getElementById('noteLetter').textContent,
  acc: document.getElementById('noteAcc').textContent,
  oct: document.getElementById('noteOct').textContent,
  cents: document.getElementById('cents').textContent,
  hz: document.getElementById('hz').textContent,
  status: document.getElementById('status').textContent,
  ref: document.getElementById('refVal').textContent,
  msg: document.getElementById('message').hidden ? null : document.getElementById('message').textContent,
})`).then(JSON.parse);

const cases = [
  { freq: 440,      label: 'A4',  status: 'In tune' },
  { freq: 466.1638, label: 'A#4', status: 'In tune' },
  { freq: 448,      label: 'A4',  status: 'Sharp'   },
  { freq: 433,      label: 'A4',  status: 'Flat'    },
  { freq: 82.4069,  label: 'E2',  status: 'In tune' },
  { freq: 329.6276, label: 'E4',  status: 'In tune' },
  { freq: 1760,     label: 'A6',  status: 'In tune' }, // was misdetected an octave down
  { freq: 2093.005, label: 'C7',  status: 'In tune' }, // above the old 2 kHz ceiling
];

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('.', import.meta.url).pathname, stdio: 'ignore',
});
const profile = mkdtempSync(join(tmpdir(), 'webtune-verify-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://localhost:${DBG}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('no page target');
}

let ok = true;
try {
  await sleep(600); // let the http server bind
  const ws = new WebSocket(await getTarget());
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
  await sleep(1000);
  await evalJS(cdp, OVERRIDE);

  for (const c of cases) {
    await evalJS(cdp, `window.__testFreq = ${c.freq}; document.getElementById('go').click();`);
    await sleep(2000);
    const dom = await readDom(cdp);
    const label = dom.letter + (dom.acc ? '#' : '') + dom.oct;
    const pass = label === c.label && dom.status === c.status;
    ok = ok && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${String(c.freq).padStart(9)} Hz -> ${label} / ${dom.status}  (${dom.cents})`);
    await evalJS(cdp, `document.getElementById('go').click();`);
    await sleep(300);
  }
  if (errors.length) { ok = false; console.log('console exceptions:', errors); }
} catch (e) {
  ok = false;
  console.log('DRIVER ERROR', e.stack);
} finally {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
  await sleep(200);
}
console.log(ok ? '\n=== ALL PASS ===' : '\n=== FAILURES ===');
process.exit(ok ? 0 : 1);
