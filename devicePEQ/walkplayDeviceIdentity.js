//
// Copyright 2026 : Pragmatic Audio
//
// WalkPlay device identity, shared by the USB HID and BLE connectors.
//
// The same dongle is the same SchemeNo whichever link it's on. Over USB the PID comes
// from the USB descriptor; over BLE the WalkPlay app reads it with the CHIP_ID command
// (see walkplayBleHandler.readWalkplayBleChipId) and then looks the scheme up. This
// module does that lookup against usbDeviceConfig.js, so both links resolve to the same
// deviceGroup / peqConstraintsRef / compensation.
//
// Band count isn't fixed per SchemeNo (CB1300 with BLE, SchemeNo13, has 8 bands; the
// group says 10). USB can detect it by reading bands; BLE can't read bands. So when USB
// detection finds fewer bands, the count is remembered per VID:PID in localStorage and
// reused when the same model connects over BLE.

const BAND_KEY = (vid, pid) =>
  `devicePEQ.walkplay.bands.${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;

export function rememberBandCount(vid, pid, count) {
  try { globalThis.localStorage?.setItem(BAND_KEY(vid, pid), String(count)); } catch (_) { /* private mode etc. */ }
}

export function recallBandCount(vid, pid) {
  try {
    const n = parseInt(globalThis.localStorage?.getItem(BAND_KEY(vid, pid)) ?? '', 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch (_) { return null; }
}

// Resolve the WalkPlay USB config for a VID/PID: defaultModelConfig + matching
// deviceGroup modelConfig — the same merge usbHidConnector does (minus name-keyed
// devices, which BLE can't match). Returns null if the VID isn't a WalkPlay vendor ID.
export async function resolveWalkplayModelConfig(vid, pid) {
  const { usbHidDeviceHandlerConfig } = await import('./usbDeviceConfig.js');
  const vendor = usbHidDeviceHandlerConfig.find(v => v.manufacturer === 'WalkPlay' && v.vendorIds?.includes(vid));
  if (!vendor) return null;
  let deviceGroup = null;
  let groupConfig = {};
  for (const [name, group] of Object.entries(vendor.deviceGroups || {})) {
    if ([...(group.productIds || []), ...(group.additionalProductIds || [])].includes(pid)) {
      deviceGroup = name;
      groupConfig = group.modelConfig || {};
      break;
    }
  }
  return { deviceGroup, modelConfig: { ...(vendor.defaultModelConfig || {}), ...groupConfig } };
}
