// deviceExtras.js
// Builds a typed extras object for a connected device.
//
// Every capability key is always present. Unsupported ones carry supported:false
// and stub get/set methods that reject with { code: 'NOT_IMPLEMENTED' }.
// This lets callers do:
//
//   if (device.extras.micGain.supported) {
//     const gain = await device.extras.micGain.get();
//     await device.extras.micGain.set(3);
//   }
//
// Without needing to check whether the handler method exists.

import { resolveExtras } from './peqConstraints.js';

function notImplemented(name) {
  return () => Promise.reject(
    Object.assign(new Error(`NOT_IMPLEMENTED: ${name}`), { code: 'NOT_IMPLEMENTED' })
  );
}

function capable(cfg, handler, device, capKey, getMethod, setMethod) {
  const capCfg = cfg?.[capKey] ?? {};
  // Device modelConfig[capKey] holds display/implementation overrides (e.g. modes, modeLabels)
  // that belong to a specific handler rather than the shared capability descriptor.
  const devCfg = device?.modelConfig?.[capKey] ?? {};
  const isSupported = capCfg.supported === true;

  const result = { supported: isSupported, ...capCfg, ...devCfg };
  delete result.handler;
  delete result.readHandler;
  delete result.note;

  if (getMethod) {
    result.get = isSupported && typeof handler?.[getMethod] === 'function'
      ? () => handler[getMethod](device)
      : notImplemented(`${capKey}.get`);
  }
  if (setMethod) {
    result.set = isSupported && typeof handler?.[setMethod] === 'function'
      ? (...args) => handler[setMethod](device, ...args)
      : notImplemented(`${capKey}.set`);
  }
  return result;
}

// Build the extras object for a device.
// handler  — the resolved handler (e.g. walkplayUsbHID)
// device   — the full device details object (has .modelConfig, .rawDevice, …)
export function buildExtras(handler, device) {
  const cfg = resolveExtras(device?.modelConfig) ?? {};
  const h = handler ?? {};

  return {
    micGain:    capable(cfg, h, device, 'micGain',    'readMicGain',       'setMicGain'),
    denoise:    capable(cfg, h, device, 'denoise',    'readDenoiseEnabled','setDenoiseEnabled'),
    dacFilter:  capable(cfg, h, device, 'dacFilter',  'readDacFilter',     'setDacFilter'),
    dacBalance: capable(cfg, h, device, 'dacBalance',  null,               'setDacBalance'),
    dacWorkMode:capable(cfg, h, device, 'dacWorkMode','readDacWorkMode',   'setDacWorkMode'),
    gainMode:   capable(cfg, h, device, 'gainMode',   'readGainMode',      'setGainMode'),
    battery:    capable(cfg, h, device, 'battery',    'readBattery',        null),
    eqEnabled:  capable(cfg, h, device, 'eqEnabled',  'readEqEnabled',     'setEqEnabled'),
    outputGain: {
      // outputGain is always offered when the handler supports it; not scheme-gated
      supported: typeof h.setOutputGain === 'function',
      set: typeof h.setOutputGain === 'function'
        ? (gainDb) => h.setOutputGain(device, gainDb)
        : notImplemented('outputGain.set'),
    },
  };
}
