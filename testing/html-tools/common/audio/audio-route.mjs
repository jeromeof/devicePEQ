// Choosing the input/output pair for a measurement, and remembering it.
//
// The *ranking* of candidate devices lives in devicePEQ/builtin-capture
// (`suggestAudioRouting`) — this module is the wrapper around it: asking the
// browser whether microphone access is already granted, enumerating without
// prompting when it is, filling the selects and remembering the choice.
//
// Kept separate from any one tool because every capture tool needs the same
// three things: permission state, populated selects, and a remembered pair.

import { rememberCookie, readCookie } from './storage.mjs';

/**
 * Chrome remembers a granted microphone permission per origin, so after the
 * first grant `enumerateDevices` returns real labels with no prompt. Querying
 * first means a tool can populate itself silently instead of demanding a click.
 * Note that permissions are not persisted for file:// pages.
 * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>}
 */
export async function microphonePermissionState() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state; }
  catch { return 'unknown'; }
}

/** True when we can enumerate labelled devices without showing a prompt. */
export async function canScanSilently() {
  return (await microphonePermissionState()) === 'granted';
}

/**
 * Populate a <select> with devices, preferring a previously chosen id.
 * @returns {boolean} whether the preferred id was still available
 */
export function fillDeviceSelect(select, devices, preferredId = '') {
  select.replaceChildren(...devices.map((d) => new Option(d.label, d.id)));
  const available = preferredId && devices.some((d) => d.id === preferredId);
  if (available) select.value = preferredId;
  return !!available;
}

/**
 * Cookie-backed memory of a chosen input/output pair.
 * @param {string} namespace distinguishes one tool's choice from another's
 */
export function createRouteMemory(namespace) {
  const key = (kind) => `${namespace}-${kind}`;
  return {
    read: () => ({ inputId: readCookie(key('input')), outputId: readCookie(key('output')) }),
    write: ({ inputId, outputId }) => {
      rememberCookie(key('input'), inputId || '');
      rememberCookie(key('output'), outputId || '');
    },
  };
}

/** Human-readable summary of why a suggestion picked what it did. */
export function describeSuggestion(suggestion) {
  const describe = (pick) => `${pick?.device?.label || 'none'} (${pick?.reasons?.join('; ') || 'no strong match'})`;
  return `input: ${describe(suggestion?.input)}; output: ${describe(suggestion?.output)}`;
}
