# webtune

A chromatic tuner that runs entirely in the browser. Point your microphone at
an instrument and it shows the note, how many cents sharp or flat you are, a
strobe band that freezes when you're in tune, and a live spectrum.

webtune is part of the [Open Collective](https://opencollective.io) suite of
open-source tools.

- **Note + cents + Hz** readout, with an adjustable A4 reference.
- **Strobe band** — stripes drift left when flat, right when sharp, and freeze in tune.
- **Diverging colour** — cyan = flat, emerald = in tune, amber = sharp.
- **Live spectrum** and an input-level meter.
- Holds the last detected note on screen when the sound fades.

## Running it

The microphone needs a **secure context**, so opening `index.html` directly
(`file://`) will not work. Serve the folder over localhost instead:

```sh
cd webtune
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static file server works, and any `https://` host works once deployed.

## Build

The app is a single self-contained `index.html` with no runtime dependencies.
`build.mjs` produces the deployable file in `dist/`, injecting the DSP from
`pitch.js` so the shipped copy is always in sync with its source:

```sh
node build.mjs      # writes dist/index.html
```

Deploy `dist/index.html` to any static host.

## How pitch detection works

The Web Audio API exposes both a real-time FFT (`AnalyserNode.getByteFrequencyData`)
and the raw waveform (`getFloatTimeDomainData`). Picking the tallest FFT bin
makes a poor tuner, though: bins are ~11 Hz wide at a 4096-point FFT, and the
loudest bin is often a harmonic rather than the fundamental, which produces
octave errors.

So webtune uses the FFT only for the on-screen spectrum and detects pitch in the
time domain with the **McLeod Pitch Method** (a normalised square difference
function). It locks onto the fundamental period directly: sub-cent accuracy
across the full piano range (~27 Hz to ~4.5 kHz), no octave errors, and it
recovers a missing fundamental from its harmonics. See `pitch.js` for the
annotated implementation.

Note that pianos are tuned with *stretched* octaves (the Railsback curve) to
compensate for string inharmonicity, so a well-tuned piano reads slightly flat
in the bass and slightly sharp in the treble against equal temperament. That is
expected — webtune reports the true measured pitch.

## Development

- `pitch.js` — the pure DSP (`detectPitch`, `frequencyToNote`, `rms`).
- `index.html` — the app, with the DSP inlined so it stays a single file.

```sh
node --test              # unit-test the DSP against synthetic tones
node verify-inlined.mjs  # check the DSP inlined in index.html matches pitch.js
node verify-ui.mjs       # end-to-end: drive the UI in headless Chrome
node build.mjs           # write the deployable dist/index.html
```

Both verifiers accept a target: `node verify-ui.mjs dist` and
`node verify-inlined.mjs dist/index.html` check the built file.

`verify-ui.mjs` drives the page with an oscillator-backed test microphone at
known frequencies and asserts the rendered note and status. It requires Google
Chrome.
