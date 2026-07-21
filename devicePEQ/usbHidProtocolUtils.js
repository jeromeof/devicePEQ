// Shared USB HID Protocol Utilities
// Common functions for Moondrop and WalkPlay handlers

import { logHidTx, logHidRx } from './deviceDebugLog.js';

// Report sending with logging
export async function sendReport(device, reportId, manufacturer, data) {
  const packet = new Uint8Array(data);
  logHidTx(manufacturer, reportId, packet);
  await device.sendReport(reportId, packet);
}

// Wait for response with timeout and optional matching
export function waitForResponse(device, manufacturer, matchFn, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      device.removeEventListener('inputreport', onReport);
      reject(`Timeout waiting for response`);
    }, timeoutMs);

    const onReport = (event) => {
      const data = new Uint8Array(event.data.buffer);
      logHidRx(manufacturer, data);
      if (!matchFn(data)) return;
      clearTimeout(timeout);
      device.removeEventListener('inputreport', onReport);
      resolve(data);
    };

    device.addEventListener('inputreport', onReport);
  });
}

// Helper for simple value encoding/decoding
export function toLittleEndianBytes(value, numBytes = 2) {
  const bytes = [];
  for (let i = 0; i < numBytes; i++) {
    bytes.push((value >> (i * 8)) & 0xFF);
  }
  return bytes;
}

export function fromLittleEndian16(lo, hi) {
  return lo | (hi << 8);
}

export function fromLittleEndianSigned16(lo, hi) {
  let value = lo | (hi << 8);
  if (value > 32767) value -= 65536;
  return value;
}

// Delay utility
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Common filter packet offsets (same for all protocols)
export const FILTER_PACKET_OFFSETS = {
  FILTER_INDEX: 4,
  FREQ_LO: 27,
  FREQ_HI: 28,
  Q_LO: 29,
  Q_HI: 30,
  GAIN_LO: 31,
  GAIN_HI: 32,
  TYPE: 33
};

// Common filter parsing (protocol-agnostic)
export function parseFilterPacketBasic(packet) {
  if (packet.length < 34) return null;

  const filterIndex = packet[FILTER_PACKET_OFFSETS.FILTER_INDEX];
  const freq = fromLittleEndian16(
    packet[FILTER_PACKET_OFFSETS.FREQ_LO],
    packet[FILTER_PACKET_OFFSETS.FREQ_HI]
  );
  const qRaw = fromLittleEndian16(
    packet[FILTER_PACKET_OFFSETS.Q_LO],
    packet[FILTER_PACKET_OFFSETS.Q_HI]
  );
  const gainRaw = fromLittleEndianSigned16(
    packet[FILTER_PACKET_OFFSETS.GAIN_LO],
    packet[FILTER_PACKET_OFFSETS.GAIN_HI]
  );
  const typeByte = packet[FILTER_PACKET_OFFSETS.TYPE];

  return {
    filterIndex,
    qRaw,
    gainRaw,
    typeByte,
    freq
  };
}
