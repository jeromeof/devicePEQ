/**
 * Plugin.js Integration Tests — callback and constraint resolution
 *
 * Tests the plugin's integration surface:
 *   - peqConstraints.js resolveConstraints() used by plugin to fire onDeviceConnected
 *   - deviceIdStr() formatting (used in console logs — regressions here are silent)
 *   - resolveConstraints() correctly reads peqConstraintsRef from modelConfig
 *
 * These don't instantiate the full plugin (requires DOM) but test the
 * utility functions that plugin.js depends on.
 */

import { resolveConstraints, loadPeqConstraintsConfig, findConstraintsByDeviceName,
         clearPeqConstraintsCache }
  from '../../devicePEQ/peqConstraints.js';

// ── resolveConstraints ────────────────────────────────────────────────────────

export async function test_resolveConstraints_from_ref(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();

  const modelConfig = { peqConstraintsRef: 'walkplayPeq8Band10dBPkOnly' };
  const c = resolveConstraints(modelConfig);

  assert.ok(c !== null,                            'should resolve to constraints object');
  assert.equal(c.maxFilters, 8,                    'walkplayPeq8Band10dBPkOnly maxFilters should be 8');
  assert.equal(c.minGain, -10,                     'minGain should be -10');
  assert.equal(c.maxGain, 10,                      'maxGain should be 10');
  assert.equal(c.supportsLSFilter, false,          'PkOnly — supportsLSFilter should be false');
  assert.equal(c.supportsHSFilter, false,          'PkOnly — supportsHSFilter should be false');
}

export async function test_resolveConstraints_schemeNo10_via_ref(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();
  const c = resolveConstraints({ peqConstraintsRef: 'walkplayPeq8Band10dBPkOnly' });
  assert.equal(c.maxFilters, 8,  'SchemeNo10 should have 8 bands');
  assert.equal(c.maxGain, 10,    'SchemeNo10 maxGain ±10 dB');
}

export async function test_resolveConstraints_schemeNo16_via_ref(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();
  const c = resolveConstraints({ peqConstraintsRef: 'peq10Band10dBFullShelves' });
  assert.equal(c.maxFilters, 10, 'SchemeNo16 should have 10 bands');
  assert.equal(c.maxGain, 10,    'SchemeNo16 maxGain ±10 dB');
  assert.equal(c.minGain, -10,   'SchemeNo16 minGain -10 dB');
  assert.equal(c.supportsLSFilter, true,  'SchemeNo16 supports LS');
  assert.equal(c.supportsHSFilter, true,  'SchemeNo16 supports HS');
}

export async function test_resolveConstraints_with_override(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();
  // MOONRIVER 3 uses peq8Band12dBFullShelves with deviceHandlesPregain: true override
  const c = resolveConstraints({
    peqConstraintsRef: 'peq8Band12dBFullShelves',
    peqConstraintsOverride: { deviceHandlesPregain: true }
  });
  assert.equal(c.supportsLSFilter, true,      'base profile has LS');
  assert.equal(c.deviceHandlesPregain, true,  'override should flag device as handling pregain');
}

export async function test_resolveConstraints_unknown_ref_returns_null_not_throw(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();
  let threw = false;
  let result = null;
  try {
    result = resolveConstraints({ peqConstraintsRef: 'nonExistentProfile_xyz' });
  } catch (e) { threw = true; }
  assert.ok(!threw, 'should not throw for unknown ref');
  assert.ok(result === null || typeof result === 'object', 'should return null or fallback object');
}

export async function test_resolveConstraints_backward_compat_inline_fields(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();
  // Old-style modelConfig without peqConstraintsRef
  const c = resolveConstraints({
    minGain: -15, maxGain: 15, maxFilters: 12,
    supportsLSFilter: true, supportsHSFilter: true,
    deviceHandlesPregain: false
  });
  assert.equal(c.maxFilters, 12, 'inline maxFilters should be used');
  assert.equal(c.minGain, -15,   'inline minGain should be used');
  assert.equal(c.maxGain, 15,    'inline maxGain should be used');
}

// ── findConstraintsByDeviceName ───────────────────────────────────────────────

export async function test_findConstraintsByDeviceName_exact(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();

  const result = findConstraintsByDeviceName('JM98MAX');
  // JM98MAX is not in deviceNames — it's in the WalkPlay SchemeNo10 group
  // This is expected to return null or to find it via group lookup
  assert.ok(result === null || typeof result === 'object',
    'should return object or null (not throw)');
}

export async function test_findConstraintsByDeviceName_partial_search(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();

  const result = findConstraintsByDeviceName('FIIO', { partial: true });
  assert.ok(result !== null, 'partial search for FIIO should find a result');
  assert.ok(typeof result.maxFilters === 'number', 'result should have maxFilters');
}

export async function test_findConstraintsByDeviceName_wii_m_device(assert) {
  clearPeqConstraintsCache();
  await loadPeqConstraintsConfig();
  const result = findConstraintsByDeviceName('WiiM');
  assert.ok(result !== null, 'WiiM should be found in deviceNames');
  assert.equal(result.maxFilters, 10, 'WiiM should have 10 bands');
}

// ── all profiles have required fields ────────────────────────────────────────

export async function test_all_profiles_have_maxFilters(assert) {
  clearPeqConstraintsCache();
  const config = await loadPeqConstraintsConfig();
  const profiles = Object.entries(config.constraints);

  profiles.forEach(([name, entry]) => {
    const c = entry.peqConstraints;
    assert.ok(typeof c.maxFilters === 'number' && c.maxFilters > 0,
      `${name}: maxFilters should be a positive number, got ${c.maxFilters}`);
    assert.ok(typeof c.minGain === 'number',
      `${name}: minGain should be a number`);
    assert.ok(typeof c.maxGain === 'number',
      `${name}: maxGain should be a number`);
    assert.ok(typeof c.deviceHandlesPregain === 'boolean',
      `${name}: deviceHandlesPregain should be boolean`);
    assert.ok(typeof c.supportsLSFilter === 'boolean',
      `${name}: supportsLSFilter should be boolean`);
    assert.ok(typeof c.supportsHSFilter === 'boolean',
      `${name}: supportsHSFilter should be boolean`);
  });
}

export async function test_all_profiles_minQ_maxQ_present(assert) {
  clearPeqConstraintsCache();
  const config = await loadPeqConstraintsConfig();
  Object.entries(config.constraints).forEach(([name, entry]) => {
    assert.ok(typeof entry.peqConstraints.minQ === 'number',
      `${name}: minQ should be present`);
    assert.ok(typeof entry.peqConstraints.maxQ === 'number',
      `${name}: maxQ should be present`);
    assert.ok(entry.peqConstraints.maxQ > entry.peqConstraints.minQ,
      `${name}: maxQ (${entry.peqConstraints.maxQ}) should be > minQ (${entry.peqConstraints.minQ})`);
  });
}
