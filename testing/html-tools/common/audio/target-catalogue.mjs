// Loading of the built-in target catalogue and the CrinGraph preference bounds.
// Files live alongside this module so the tool stays self-contained; adding a
// target means dropping a file in common/targets/ and listing it in index.json.

import { parseFrequencyPairs } from './frequency-response.mjs';

const CATALOGUE_URL = new URL('../targets/index.json', import.meta.url);
const targetUrl = (file) => new URL(`../targets/${encodeURIComponent(file)}`, import.meta.url);

/** @returns {{targets:Array, boundsConfig:object|null}} */
export async function loadCatalogue() {
  try {
    const r = await fetch(CATALOGUE_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const cat = await r.json();
    return { targets: cat.targets || [], boundsConfig: cat.prefBounds || null };
  } catch {
    return { targets: [], boundsConfig: null };
  }
}

export async function loadTargetPoints(entry) {
  const r = await fetch(targetUrl(entry.file));
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return parseFrequencyPairs(await r.text());
}

/**
 * The preference bounds are dB deltas over a diffuse-field base, which is why the
 * envelope is wide in the bass and treble and narrow through the mids.
 * @returns {{upper:Array, lower:Array}}
 */
export async function loadPrefBounds(boundsConfig) {
  const dir = new URL(boundsConfig.dir || './', new URL('../targets/', import.meta.url));
  const [upper, lower] = await Promise.all([boundsConfig.upper, boundsConfig.lower].map(async (name) => {
    const r = await fetch(new URL(encodeURIComponent(name), dir));
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return parseFrequencyPairs(await r.text());
  }));
  return { upper, lower };
}
