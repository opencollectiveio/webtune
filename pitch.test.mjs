import { test } from 'node:test';
import assert from 'node:assert/strict';

// The module under test defaults to pitch.js but can be pointed at the DSP
// extracted from the shipped index.html (see verify-inlined.mjs) so the exact
// code that runs in the browser is exercised by these same tests.
const MODULE = process.env.DSP_MODULE ?? './pitch.js';
const { frequencyToNote, detectPitch } = await import(MODULE);

// --- helpers ---------------------------------------------------------------

// Cents between two frequencies (how far `f` is above `ref`).
function centsBetween(f, ref) {
  return 1200 * Math.log2(f / ref);
}

// Build a Float32Array of `len` samples summing the given partials.
// partials: [{ freq, amp }]
function makeTone(partials, sampleRate, len) {
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const p of partials) {
      s += p.amp * Math.sin((2 * Math.PI * p.freq * i) / sampleRate);
    }
    buf[i] = s;
  }
  return buf;
}

const SR = 44100;
const N = 4096;

// --- frequencyToNote -------------------------------------------------------

test('frequencyToNote: 440 Hz is A4 with 0 cents', () => {
  const r = frequencyToNote(440);
  assert.equal(r.name, 'A');
  assert.equal(r.octave, 4);
  assert.equal(r.label, 'A4');
  assert.equal(r.midi, 69);
  assert.ok(Math.abs(r.cents) < 0.001, `cents=${r.cents}`);
  assert.ok(Math.abs(r.targetFreq - 440) < 1e-9);
});

test('frequencyToNote: 261.6256 Hz is C4', () => {
  const r = frequencyToNote(261.6255653);
  assert.equal(r.label, 'C4');
  assert.equal(r.midi, 60);
  assert.ok(Math.abs(r.cents) < 0.01, `cents=${r.cents}`);
});

test('frequencyToNote: 466.1638 Hz is A#4', () => {
  const r = frequencyToNote(466.1637615);
  assert.equal(r.label, 'A#4');
  assert.equal(r.midi, 70);
  assert.ok(Math.abs(r.cents) < 0.01, `cents=${r.cents}`);
});

test('frequencyToNote: 82.4069 Hz is E2 (low guitar string)', () => {
  const r = frequencyToNote(82.4069);
  assert.equal(r.label, 'E2');
  assert.equal(r.midi, 40);
  assert.ok(Math.abs(r.cents) < 0.01, `cents=${r.cents}`);
});

test('frequencyToNote: 445 Hz reads as A4 about +19.6 cents sharp', () => {
  const r = frequencyToNote(445);
  assert.equal(r.label, 'A4');
  assert.ok(Math.abs(r.cents - 19.56) < 0.1, `cents=${r.cents}`);
});

test('frequencyToNote: cents is negative when flat', () => {
  const r = frequencyToNote(435); // below 440
  assert.equal(r.label, 'A4');
  assert.ok(r.cents < 0, `cents=${r.cents}`);
});

test('frequencyToNote: honours a custom A4 reference (432 Hz)', () => {
  const r = frequencyToNote(432, 432);
  assert.equal(r.label, 'A4');
  assert.ok(Math.abs(r.cents) < 0.001, `cents=${r.cents}`);
});

// --- detectPitch -----------------------------------------------------------

test('detectPitch: detects a 440 Hz sine within 1 cent', () => {
  const buf = makeTone([{ freq: 440, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 440)) < 1, `detected ${f} Hz`);
});

test('detectPitch: detects a 220 Hz sine within 1 cent', () => {
  const buf = makeTone([{ freq: 220, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 220)) < 1, `detected ${f} Hz`);
});

test('detectPitch: detects a low 82.41 Hz sine within 1 cent (low-freq bias fixed)', () => {
  const buf = makeTone([{ freq: 82.41, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 82.41)) < 1, `detected ${f} Hz`);
});

test('detectPitch: detects a high 1318.5 Hz sine within 1 cent', () => {
  const buf = makeTone([{ freq: 1318.5, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 1318.5)) < 1, `detected ${f} Hz`);
});

test('detectPitch: detects A6 (1760 Hz) without an octave error', () => {
  const buf = makeTone([{ freq: 1760, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 1760)) < 2, `detected ${f} Hz`);
});

test('detectPitch: detects C7 (2093 Hz) without an octave error', () => {
  const buf = makeTone([{ freq: 2093.005, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 2093.005)) < 2, `detected ${f} Hz`);
});

test('detectPitch: detects the top piano note C8 (4186 Hz) as the right note', () => {
  const buf = makeTone([{ freq: 4186.01, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  // Near the resolution limit; require the correct note (no octave error).
  assert.ok(Math.abs(centsBetween(f, 4186.01)) < 15, `detected ${f} Hz`);
});

test('detectPitch: reads a detuned 445 Hz tone, not snapped to 440', () => {
  const buf = makeTone([{ freq: 445, amp: 0.8 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 445)) < 1, `detected ${f} Hz`);
});

test('detectPitch: finds the fundamental even when a harmonic is louder (no octave error)', () => {
  // 110 Hz fundamental with a 2nd harmonic (220 Hz) that is louder.
  const buf = makeTone(
    [{ freq: 110, amp: 0.5 }, { freq: 220, amp: 1.0 }],
    SR,
    N,
  );
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 110)) < 5, `detected ${f} Hz (expected ~110)`);
});

test('detectPitch: recovers a missing fundamental from its harmonics', () => {
  // Only the 2nd/3rd/4th harmonics of 100 Hz are present; no 100 Hz component.
  const buf = makeTone(
    [{ freq: 200, amp: 1.0 }, { freq: 300, amp: 0.8 }, { freq: 400, amp: 0.6 }],
    SR,
    N,
  );
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 100)) < 5, `detected ${f} Hz (expected ~100)`);
});

test('detectPitch: stays accurate on a harmonic-rich tone with added noise', () => {
  // Deterministic pseudo-random noise (Math.random avoided for reproducibility).
  let s = 7 >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    buf[i] =
      0.6 * Math.sin((2 * Math.PI * 196 * i) / SR) +
      0.3 * Math.sin((2 * Math.PI * 392 * i) / SR) +
      0.05 * rnd();
  }
  const f = detectPitch(buf, SR);
  assert.ok(Math.abs(centsBetween(f, 196)) < 3, `detected ${f} Hz (expected ~196)`);
});

test('detectPitch: returns -1 for silence', () => {
  const buf = new Float32Array(N); // all zeros
  const f = detectPitch(buf, SR);
  assert.equal(f, -1);
});

test('detectPitch: returns -1 for sub-threshold noise', () => {
  const buf = makeTone([{ freq: 440, amp: 0.001 }], SR, N);
  const f = detectPitch(buf, SR);
  assert.equal(f, -1);
});
