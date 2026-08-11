// Turning a published target curve into the one a graph actually compares
// against: tilt, level matching and preference-envelope shaping.
//
// The conventions follow CrinGraph so results are comparable with it.

import { interpolateLog, responseDbAt } from './frequency-response.mjs';
import { logSamples } from './axis.mjs';

/** Band used when a tool level-matches across a range instead of at one point. */
export const ALIGN_BAND = Object.freeze({ lo: 200, hi: 2000, steps: 40 });

/**
 * CrinGraph applies tilt as `tilt * log2(f)` dB/octave. Hinging on the
 * normalisation frequency keeps the tilt and the level match anchored together.
 */
export const tiltDbAt = (f, dbPerOctave, pivotHz) => dbPerOctave * Math.log2(f / pivotHz);

/** Target dB including any tilt, before level matching. */
export const targetDbAt = (target, f, dbPerOctave, pivotHz) =>
  interpolateLog(target, f) + tiltDbAt(f, dbPerOctave, pivotHz);

/**
 * Target files are level-normalised while a capture carries the rig's own
 * absolute level, so the two would otherwise sit tens of dB apart. Match them at
 * the normalisation point (or across a band) and keep the comparison about shape.
 */
export function levelMatchOffset(reference, targetAt, { atHz, band }) {
  if (!reference) return 0;
  if (!band) {
    const db = responseDbAt(reference, atHz);
    return Number.isFinite(db) ? db - targetAt(atHz) : 0;
  }
  let sumRef = 0, sumTarget = 0, n = 0;
  for (const f of logSamples(ALIGN_BAND.lo, ALIGN_BAND.hi, ALIGN_BAND.steps)) {
    const db = responseDbAt(reference, f);
    if (!Number.isFinite(db)) continue;
    sumRef += db; sumTarget += targetAt(f); n++;
  }
  return n ? (sumRef - sumTarget) / n : 0;
}

/** Re-centre an envelope on its target, keeping its width but dropping its offset. */
export function centreEnvelope({ hi, lo }) {
  const mid = (hi + lo) / 2;
  return { hi: hi - mid, lo: lo - mid };
}
