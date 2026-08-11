# Shared audio modules

Tool-agnostic ES modules for building frequency-response tools. No framework, no
build step, no external dependencies — import them straight from a page.

Everything here is deliberately free of tool-specific assumptions: no fixed
storage keys, no hard-coded position names, no rendering library. The one DOM
dependency is confined to `dom.mjs` and `files.mjs`, so the maths modules can be
imported by node for testing.

| Module | What it gives you |
| --- | --- |
| `frequency-response.mjs` | Parse two-column FR files (REW/CrinGraph/AutoEQ), log interpolation, nearest-bin lookup, apply a calibration, compare two responses |
| `axis.mjs` | Log-frequency sampling, zoom-stable tick ladders, dB axis fitting, gridline steps, Hz formatting |
| `target-shaping.mjs` | CrinGraph-compatible tilt (`tilt * log2(f)`), level matching at a point or across a band, envelope re-centring |
| `target-catalogue.mjs` | Loads `../targets/index.json`, target files and the preference bounds |
| `audio-route.mjs` | Microphone permission state, silent enumeration when already granted, populating device selects, remembering a chosen input/output pair |
| `rew.mjs` | One REW-importable measurement file (REW imports one measurement per file) |
| `zip.mjs` | Dependency-free stored-entry ZIP writer, for multi-file exports |
| `storage.mjs` | Preference store per key, reporting whether a write actually landed; cookie helpers |
| `files.mjs` | `downloadText` / `downloadBlob` |
| `dom.mjs` | `$`, `value`, `number`, `checked`, `setStatus`, `setHtml`, `on` |
| `color.mjs` | `rgba(hex, alpha)` |

## Conventions

A **response** is `{ startFreq, freqStep, magnitude: Float32Array }` — the shape
`devicePEQ/builtin-capture` produces. A **curve** is a sorted array of
`{ freq, db }`, which is what parsing a text file yields.

## Capture

Sweep capture, device enumeration, routing suggestions and smoothing live in
`devicePEQ/builtin-capture/index.mjs`, which both tools import. `suggestAudioRouting`
ranks candidate devices; `audio-route.mjs` here is the wrapper around it
(permission, populating selects, remembering the choice):

```js
const { BuiltinCaptureBackend, enumerateAudioDevices, suggestAudioRouting, smoothResponse, averageResponses }
  = await import(`${base}builtin-capture/index.mjs`);
```

## Example

```js
import { parseFrequencyPairs, peakDifference } from './common/audio/frequency-response.mjs';
import { axisTicks, tickLabel } from './common/audio/axis.mjs';
import { createZip } from './common/audio/zip.mjs';
import { exportRewMeasurement } from './common/audio/rew.mjs';

const target = parseFrequencyPairs(await file.text());
const ticks = axisTicks(200, 2000).map(tickLabel);        // 200 300 500 700 1k 2k
const zip = createZip([{ name: 'A.txt', text: exportRewMeasurement(response, { name: 'A' }) }]);
```
