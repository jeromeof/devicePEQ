// Verbose wire-level logging for USB HID handlers, gated behind the same debugLogs flag
// plugin.js exposes via window.devicePEQDebugLogs (see setupDevicePeqLogCapture in plugin.js).
// Off by default - only prints when that flag is true, so normal usage isn't spammed with
// raw report bytes.
function toHex(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data?.buffer ?? data ?? []);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

export function logHidTx(handlerName, reportId, data) {
  if (typeof window === 'undefined' || !window.devicePEQDebugLogs) return;
  console.log(`USB Device PEQ: [${handlerName}] TX reportId=${reportId} bytes=[${toHex(data)}]`);
}

export function logHidRx(handlerName, data) {
  if (typeof window === 'undefined' || !window.devicePEQDebugLogs) return;
  console.log(`USB Device PEQ: [${handlerName}] RX bytes=[${toHex(data)}]`);
}
