# DevicePEQ built-in capture

This folder contains DevicePEQ's independent browser-native measurement backend.
It is not copied from Phonalyser. Phonalyser was used only as a reference for
measurement concepts such as logarithmic sweeps, audio lifecycle handling, and
frequency-response deconvolution.

## Current contents

- `sweep.mjs` — validation, exponential sweep rendering, fades, and padding.
- `fft.mjs` — dependency-free radix-2 complex FFT.
- `deconvolution.mjs` — complex frequency-response estimation.
- `response.mjs` — conversion to the REW-compatible linear response shape.
- `devices.mjs` — browser input/output discovery and permission handling.
- `audio-session.mjs` — input capture, output routing, stereo buffering, and teardown.
- `measurement.mjs` — one-shot sweep/capture/deconvolution orchestration.
- `builtin-capture.html` — standalone browser diagnostic page.

The backend rejects input/output clock mismatches by default. This prevents the
browser's hidden resampling stage from being treated as part of an unchanged
measurement path. A future explicitly-labelled resampling mode can be added once
there are calibrated tests for it.
