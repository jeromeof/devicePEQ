// peqConstraints.js
// Central interface for querying PEQ constraint profiles from peqConstraintsConfig.json.
// Supports lookup by reference name, device name, device group name, and partial search.

// Default: load constraints from the file sitting next to this module, so the URL is correct
// wherever the library is hosted (a page-relative './devicePEQ/...' breaks when the page lives
// in a different directory, e.g. /headphones/ vs /headphones/assets/js/devicePEQ/).
// To override, set window.DEVICEPEQ_CONFIG_BASE_URL or config.peqConstraintsUrl in your config.js:
//   peqConstraintsUrl: 'https://www.pragmaticaudio.com/headphones/assets/js/devicePEQ/peqConstraintsConfig.json'
const PEQ_CONSTRAINTS_FALLBACK_URL = new URL('./peqConstraintsConfig.json', import.meta.url).href;
const PEQ_CONSTRAINTS_CONFIG_URL =
  typeof window !== 'undefined' && window.DEVICEPEQ_CONFIG_BASE_URL
    ? `${window.DEVICEPEQ_CONFIG_BASE_URL}peqConstraintsConfig.json`
    : PEQ_CONSTRAINTS_FALLBACK_URL;

let _config = null;
let _loadPromise = null;

// Load (and cache) the constraints config from the given URL.
// Subsequent calls return the cached result without re-fetching.
export async function loadPeqConstraintsConfig(url = PEQ_CONSTRAINTS_CONFIG_URL, config = {}) {
  if (_config) return _config;
  if (_loadPromise) return _loadPromise;

  // Allow override from config object
  const configUrl = config.peqConstraintsUrl || url;

  const tryFetch = (fetchUrl) =>
    fetch(fetchUrl).then(r => {
      if (!r.ok) throw new Error(`Failed to load peqConstraintsConfig: ${r.status} ${r.statusText}`);
      return r.json();
    });

  _loadPromise = tryFetch(configUrl)
    .catch(() => tryFetch(PEQ_CONSTRAINTS_FALLBACK_URL))
    .then(data => {
      _config = data;
      _loadPromise = null;
      return data;
    })
    .catch(err => {
      _loadPromise = null;
      throw err;
    });

  return _loadPromise;
}

// Returns the cached config, or null if not yet loaded.
export function getPeqConstraintsConfig() {
  return _config;
}

// Clears the cache — useful for testing or hot-reload scenarios.
export function clearPeqConstraintsCache() {
  _config = null;
  _loadPromise = null;
}

// Returns the peqConstraints object for a named profile ref, or null if not found.
export function getConstraintsByRef(refName) {
  if (!_config) return null;
  const entry = _config.constraints[refName];
  return entry ? { ...entry.peqConstraints } : null;
}

// Returns all available constraint reference names.
export function getAllConstraintRefs() {
  if (!_config) return [];
  return Object.keys(_config.constraints);
}

// Returns the full entry (description, peqConstraints, deviceNames, deviceGroupNames)
// for a named profile ref.
export function getConstraintEntry(refName) {
  if (!_config) return null;
  const entry = _config.constraints[refName];
  return entry ? { refName, ...entry } : null;
}

// Finds the constraint profile for a specific device name.
// Set partial:true for substring matching (case-insensitive).
// Returns { refName, ...peqConstraints } or null.
export function findConstraintsByDeviceName(deviceName, { partial = false } = {}) {
  if (!_config) return null;
  const query = partial ? deviceName.toLowerCase() : deviceName;

  for (const [refName, entry] of Object.entries(_config.constraints)) {
    const match = entry.deviceNames?.some(d =>
      partial ? d.toLowerCase().includes(query) : d === deviceName
    );
    if (match) return { refName, ...entry.peqConstraints };
  }
  return null;
}

// Finds the constraint profile for a device group name.
// Set partial:true for substring matching (case-insensitive).
// Returns { refName, ...peqConstraints } or null.
export function findConstraintsByDeviceGroupName(groupName, { partial = false } = {}) {
  if (!_config) return null;
  const query = partial ? groupName.toLowerCase() : groupName;

  for (const [refName, entry] of Object.entries(_config.constraints)) {
    const match = entry.deviceGroupNames?.some(g =>
      partial ? g.toLowerCase().includes(query) : g === groupName
    );
    if (match) return { refName, ...entry.peqConstraints };
  }
  return null;
}

// Searches across both deviceNames and deviceGroupNames for the given query string.
// Always uses partial/case-insensitive matching.
// Returns an array of { refName, description, peqConstraints, matchedNames }.
export function searchDevices(query) {
  if (!_config) return [];
  const q = query.toLowerCase();
  const results = [];

  for (const [refName, entry] of Object.entries(_config.constraints)) {
    const matchedDevices = (entry.deviceNames || []).filter(d => d.toLowerCase().includes(q));
    const matchedGroups = (entry.deviceGroupNames || []).filter(g => g.toLowerCase().includes(q));

    if (matchedDevices.length > 0 || matchedGroups.length > 0) {
      results.push({
        refName,
        description: entry.description,
        peqConstraints: { ...entry.peqConstraints },
        matchedDeviceNames: matchedDevices,
        matchedDeviceGroupNames: matchedGroups
      });
    }
  }
  return results;
}

// Returns the extras object for a named profile ref, or null if not found / not defined.
export function getExtras(refName) {
  if (!_config) return null;
  const entry = _config.constraints[refName];
  return entry?.extras ? { ...entry.extras } : null;
}

// Resolves the extras for a modelConfig object (mirrors resolveConstraints for the extras block).
// Returns the extras from the named peqConstraintsRef profile, or null.
export function resolveExtras(modelConfig) {
  if (!modelConfig?.peqConstraintsRef) return null;
  return getExtras(modelConfig.peqConstraintsRef);
}

// Resolves the effective peqConstraints for a modelConfig object.
// If the modelConfig has a peqConstraintsRef, looks up the named profile.
// Falls back to extracting inline peqConstraints fields for backward compatibility.
// writeOnly is a PEQ readback capability shared by every transport. Identity and
// independently supported extras may still be read. Keep supportsRead for hosts
// using the older flag; writeOnly always wins over a readable constraint profile.
function withReadCapabilities(constraints, modelConfig) {
  const override = modelConfig.peqConstraintsOverride;
  const writeOnly = override?.writeOnly ?? modelConfig.writeOnly ?? constraints.writeOnly;
  const supportsRead = override?.supportsRead ?? modelConfig.supportsRead ?? constraints.supportsRead;
  return {
    ...constraints,
    ...(writeOnly !== undefined ? { writeOnly } : {}),
    ...(writeOnly === true ? { supportsRead: false }
      : supportsRead !== undefined ? { supportsRead } : {}),
  };
}

export function resolveConstraints(modelConfig) {
  if (!modelConfig) return null;

  if (modelConfig.peqConstraintsRef) {
    const resolved = getConstraintsByRef(modelConfig.peqConstraintsRef);
    if (resolved) {
      // Allow per-device overrides via peqConstraintsOverride
      return withReadCapabilities(modelConfig.peqConstraintsOverride
        ? { ...resolved, ...modelConfig.peqConstraintsOverride }
        : resolved, modelConfig);
    }
  }

  // Backward-compat: extract known peqConstraints fields directly from modelConfig.
  // supportsLPHPFilters is the old combined flag — expand it into the two separate flags.
  const {
    minGain, maxGain, maxFilters,
    minQ, maxQ,
    supportsLSFilter, supportsHSFilter,
    supportsLPFilter, supportsHPFilter,
    supportsLPHPFilters,             // legacy combined flag — mapped below
    supportsBPFilter,
    supportsNotchFilter,
    supportsBandStopFilter,
    supportsConstantQFilter,
    supportsAllPassFilter,
    deviceHandlesPregain, supportsManualGlobalGain, supportedFilterTypes
  } = modelConfig;

  const hasLP = supportsLPFilter ?? supportsLPHPFilters ?? false;
  const hasHP = supportsHPFilter ?? supportsLPHPFilters ?? false;

  return withReadCapabilities({
    minGain, maxGain, maxFilters,
    minQ: minQ ?? 0.1,
    maxQ: maxQ ?? 10.0,
    supportsLSFilter,
    supportsHSFilter,
    supportsLPFilter:         hasLP,
    supportsHPFilter:         hasHP,
    supportsBPFilter:         supportsBPFilter         ?? false,
    supportsNotchFilter:      supportsNotchFilter      ?? false,
    supportsBandStopFilter:   supportsBandStopFilter   ?? false,
    supportsConstantQFilter:  supportsConstantQFilter  ?? false,
    supportsAllPassFilter:    supportsAllPassFilter    ?? false,
    deviceHandlesPregain,
    supportsManualGlobalGain,
    supportedFilterTypes
  }, modelConfig);
}
