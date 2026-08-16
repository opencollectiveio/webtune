// pitch.js — pure DSP helpers for a chromatic tuner.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert a frequency in Hz to the nearest musical note and its deviation.
 * @param {number} freq - detected frequency in Hz (> 0)
 * @param {number} [a4=440] - reference pitch for A4 in Hz
 * @returns {{ midi:number, name:string, octave:number, label:string, cents:number, targetFreq:number }}
 */
export function frequencyToNote(freq, a4 = 440) {
  // MIDI note number as a real value; A4 = 69.
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiFloat);
  // 1 semitone = 100 cents; deviation from the nearest note.
  const cents = 100 * (midiFloat - midi);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const targetFreq = a4 * Math.pow(2, (midi - 69) / 12);
  return { midi, name, octave, label: `${name}${octave}`, cents, targetFreq };
}

/**
 * Root-mean-square amplitude of a buffer — a cheap "how loud is the input"
 * measure, used both to gate silence and to drive the on-screen level meter.
 * @param {Float32Array|number[]} buf
 * @returns {number}
 */
export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * Estimate the fundamental frequency of a signal using the McLeod Pitch Method
 * (a Normalised Square Difference Function).
 *
 * Working in the time domain locks onto the fundamental *period* directly, so —
 * unlike picking the tallest FFT bin — it does not suffer octave errors when a
 * harmonic is louder than the fundamental, and it even recovers a *missing*
 * fundamental from its harmonics. The NSDF is amplitude-normalised (bounded to
 * [-1, 1]), which removes the low-frequency bias of raw autocorrelation, and a
 * parabolic interpolation around the chosen peak yields sub-cent precision.
 *
 * @param {Float32Array|number[]} buf - time-domain samples in [-1, 1]
 * @param {number} sampleRate - samples per second
 * @param {{ rmsThreshold?: number, minFreq?: number, maxFreq?: number, clarity?: number }} [opts]
 * @returns {number} fundamental frequency in Hz, or -1 if no clear pitch
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const rmsThreshold = opts.rmsThreshold ?? 0.01;
  const minFreq = opts.minFreq ?? 27;   // A0 = 27.5 Hz — full piano range
  const maxFreq = opts.maxFreq ?? 4500;  // above C8 = 4186 Hz
  const clarity = opts.clarity ?? 0.9; // accept the first peak within 90% of the tallest
  const n = buf.length;

  // Gate out silence / signal too weak to trust.
  if (rms(buf) < rmsThreshold) return -1;

  // Only consider lags corresponding to plausible musical pitches.
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / minFreq));
  const minLag = Math.max(1, Math.floor(sampleRate / maxFreq));

  // Normalised Square Difference Function.
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0; // sum x[i]*x[i+lag]
    let m = 0; // sum x[i]^2 + x[i+lag]^2
    for (let i = 0; i < n - lag; i++) {
      acf += buf[i] * buf[i + lag];
      m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
    }
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0;
  }

  // Skip the central lobe: advance from lag 1 until the NSDF first turns
  // negative. This MUST start at lag 1, not minLag — for high notes minLag can
  // fall inside the first genuine period peak, which would then be consumed as
  // if it were the central lobe, and the detector would lock onto the 2x-period
  // peak instead (an octave-down error).
  let lag = 1;
  while (lag <= maxLag && nsdf[lag] > 0) lag++;

  // Collect the local maximum of each positive region, keeping only peaks whose
  // lag is a plausible fundamental (>= minLag, i.e. frequency <= maxFreq).
  const peaks = [];
  while (lag <= maxLag) {
    if (nsdf[lag] > 0) {
      let peakLag = lag;
      let peakVal = nsdf[lag];
      while (lag <= maxLag && nsdf[lag] > 0) {
        if (nsdf[lag] > peakVal) {
          peakVal = nsdf[lag];
          peakLag = lag;
        }
        lag++;
      }
      if (peakLag >= minLag) peaks.push([peakLag, peakVal]);
    } else {
      lag++;
    }
  }
  if (peaks.length === 0) return -1;

  // Choose the FIRST peak that is tall enough. Preferring the earliest strong
  // peak (rather than the global maximum) is what keeps octaves correct.
  let best = -Infinity;
  for (const [, v] of peaks) if (v > best) best = v;
  const threshold = clarity * best;
  const chosen = peaks.find(([, v]) => v >= threshold);
  if (!chosen) return -1;

  // Parabolic interpolation around the chosen peak for sub-sample precision.
  const p = chosen[0];
  const x1 = p > 0 ? nsdf[p - 1] : nsdf[p];
  const x2 = nsdf[p];
  const x3 = p < maxLag ? nsdf[p + 1] : nsdf[p];
  const denom = x1 + x3 - 2 * x2;
  const period = denom !== 0 ? p - (0.5 * (x3 - x1)) / denom : p;

  return sampleRate / period;
}

export { NOTE_NAMES };
