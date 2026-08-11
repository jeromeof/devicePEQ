// Log-frequency and dB axis maths, shared by any tool that plots a response —
// canvas or SVG, since nothing here touches a rendering API.

/** The full audible span these tools plot. */
export const FULL_RANGE = Object.freeze({ fMin: 20, fMax: 20000 });
export const FULL_RANGE_OCTAVES = Math.log2(FULL_RANGE.fMax / FULL_RANGE.fMin);

/** n+1 log-spaced frequencies from fMin to fMax inclusive. */
export function logSamples(fMin, fMax, n) {
  const ratio = fMax / fMin, out = new Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = fMin * Math.pow(ratio, i / n);
  return out;
}

// Round frequencies should stay round at any zoom, so try progressively finer
// ladders and keep the first that yields a usable number of ticks. A fixed
// 20/50/100/…/20k list degenerates once zoomed: a 900–1100 Hz window would show
// a single gridline.
const TICK_LADDERS = [[1, 2, 5], [1, 1.5, 2, 3, 5, 7], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]];

/**
 * Round gridline frequencies for a visible range.
 * @param {object} [options]
 * @param {number} [options.minTicks=4]  accept a ladder once it yields this many
 * @param {number} [options.maxTicks=0]  thin the result to at most this many (0 = no cap)
 * @param {number} [options.fallbackCount=7] evenly log-spaced ticks when too few round values fit
 */
export function axisTicks(fMin, fMax, { minTicks = 4, maxTicks = 0, fallbackCount = 7 } = {}) {
  // Relative epsilon, not a bare comparison: range bounds that have been through
  // Math.pow(2, Math.log2(f)) come back as 20.000000000000004, which would
  // silently drop the edge gridlines.
  const lo = fMin * (1 - 1e-9), hi = fMax * (1 + 1e-9);
  let best = [];
  for (const ladder of TICK_LADDERS) {
    const ticks = [];
    for (let decade = Math.floor(Math.log10(lo)); decade <= Math.ceil(Math.log10(hi)); decade++)
      for (const m of ladder) {
        const f = m * Math.pow(10, decade);
        if (f >= lo && f <= hi) ticks.push(f);
      }
    best = ticks;
    if (ticks.length >= minTicks) break;
  }
  // Too narrow for enough round values — two lonely gridlines read worse than a
  // regular scale, so fall back to evenly log-spaced ticks and let the caller's
  // label precision carry the detail.
  if (best.length < minTicks) return logSamples(fMin, fMax, Math.max(1, fallbackCount - 1));
  if (maxTicks && best.length > maxTicks) {
    const stride = Math.ceil(best.length / maxTicks);
    if (stride > 1) best = best.filter((_, i) => i % stride === 0);
  }
  return best;
}

export const tickLabel = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${+f.toFixed(f < 100 ? 1 : 0)}`);

export const formatHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(f < 10000 ? 2 : 1)} kHz` : `${Math.round(f)} Hz`);

/** Largest gridline step that keeps an axis under ~12 lines. */
export function gridStep(span, ladder = [1, 2, 5, 10, 20, 25, 50]) {
  return ladder.find((step) => span / step <= 12) || ladder[ladder.length - 1] * 2;
}

/**
 * Fit a dB axis around the values on screen.
 * `spanDb` pins the height (centred on the data); otherwise it pads and snaps to 5 dB.
 */
export function fitVerticalRange(min, max, spanDb = 0) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (spanDb) {
    const mid = (min + max) / 2, half = spanDb / 2;
    return { ymin: mid - half, ymax: mid + half, step: gridStep(spanDb, [0.5, 1, 2, 5, 10, 20, 25]) };
  }
  const pad = Math.max(3, (max - min) * 0.08);
  let ymin = Math.floor((min - pad) / 5) * 5, ymax = Math.ceil((max + pad) / 5) * 5;
  if (ymax - ymin < 20) { ymin = Math.floor(((ymax + ymin) / 2 - 10) / 5) * 5; ymax = ymin + 20; }
  return { ymin, ymax, step: gridStep(ymax - ymin) };
}
