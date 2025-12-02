//
// Copyright 2024 : Pragmatic Audio
//
// Luxsin X9 Network Handler for PEQ over HTTP API
// Uses custom base64 alphabet encoding used by /dev/info.cgi
//

export const luxsinNetworkHandler = (function () {
  // Custom encoding/decoding alphabets from sample controller
  const RC = "KLMPQRSTUVWXYZABCGHdefIJjkNOlmnopqrstuvwxyzabcghiDEF34501289+67/";
  const PC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function encodeCustom(text) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) binaryString += String.fromCharCode(bytes[i]);
    const base64 = btoa(binaryString);
    let encoded = '';
    for (let i = 0; i < base64.length; i++) {
      const ch = base64.charAt(i);
      const idx = PC.indexOf(ch);
      encoded += idx !== -1 ? RC.charAt(idx) : ch;
    }
    return encoded;
  }

  function decodeCustom(encoded) {
    let base64 = '';
    for (let i = 0; i < encoded.length; i++) {
      const ch = encoded.charAt(i);
      const idx = RC.indexOf(ch);
      base64 += idx !== -1 ? PC.charAt(idx) : ch;
    }
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Helpers to normalize filter types between app and Luxsin API
  function toLuxsinType(type) {
    if (typeof type === 'number') return type; // assume already Luxsin code
    const map = {
      'LPF': 0,
      'Low-Pass': 0,
      'HPF': 1,
      'High-Pass': 1,
      'BPF': 2,
      'Band-Pass': 2,
      'Notch': 3,
      'Peak': 4,
      'PK': 4,
      'Low-Shelf': 5,
      'LSQ': 5,
      'High-Shelf': 6,
      'HSQ': 6,
      'AllPass': 7,
      'All-Pass': 7,
    };
    return map[type] !== undefined ? map[type] : 4; // default to Peak
  }

  function fromLuxsinType(code) {
    // Map Luxsin numeric types back to the short codes used by the app UI
    // so that pulled filters display correctly as PK / LSQ / HSQ, etc.
    switch (Number(code)) {
      case 0: return 'LPF';           // Low-pass
      case 1: return 'HPF';           // High-pass
      case 2: return 'BPF';           // Band-pass
      case 3: return 'NOTCH';         // Notch (short code form)
      case 4: return 'PK';            // Peaking
      case 5: return 'LSQ';           // Low-shelf
      case 6: return 'HSQ';           // High-shelf
      case 7: return 'ALLPASS';       // All-pass
      default: return 'PK';           // Default to Peaking
    }
  }

  async function httpGet(ip, pathAndQuery) {
    const url = `http://${ip}${pathAndQuery}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.text();
  }

  async function httpPostJsonEncoded(ip, path, obj) {
    const jsonStr = JSON.stringify(obj);
    const encodedJson = encodeCustom(jsonStr);
    const body = new URLSearchParams();
    body.append('json', encodedJson);
    const url = `http://${ip}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return true;
  }

  // Pull PEQ settings and normalize for the app
  async function pullFromDevice(device, slot) {
    try {
      const [syncDataText, syncPeqText] = await Promise.all([
        httpGet(device.ip, '/dev/info.cgi?action=syncData'),
        httpGet(device.ip, '/dev/info.cgi?action=syncPeq').catch(() => '')
      ]);

      const deviceData = JSON.parse(decodeCustom(syncDataText));
      if (syncPeqText) {
        const peqData = JSON.parse(decodeCustom(syncPeqText));
        if (peqData.peq) deviceData.peq = peqData.peq;
        if (peqData.peqSelect !== undefined) deviceData.peqSelect = peqData.peqSelect;
        if (peqData.peqEnable !== undefined) deviceData.peqEnable = peqData.peqEnable;
      }

      // Determine current profile and map filters
      let filters = [];
      let preamp = 0;
      const currentIndex = deviceData.peqSelect ?? 0;
      const currentProfile = Array.isArray(deviceData.peq) ? deviceData.peq[currentIndex] : null;
      if (currentProfile) {
        preamp = Number(currentProfile.preamp) || 0;
        try {
          const rawFilters = JSON.parse(currentProfile.filters || '[]');
          filters = rawFilters.map(f => ({
            type: fromLuxsinType(Number(f.type)),
            freq: Number(f.fc),
            q: Number(f.q),
            gain: Number(f.gain)
          }));
        } catch (e) {
          console.warn('Luxsin: failed to parse filters JSON', e);
        }
      }

      const deviceDetails = {
        maxFilters: 10,
        profiles: Array.isArray(deviceData.peq) ? deviceData.peq.map((p, idx) => ({ id: idx, name: p.name || `Profile ${idx}` })) : []
      };

      return { filters, globalGain: preamp, currentSlot: currentIndex, deviceDetails };
    } catch (err) {
      console.error('Luxsin: error pulling from device', err);
      throw err;
    }
  }

  // Push filters/preamp to current or specified slot
  async function pushToDevice(device, phoneObj, slot, preamp, filters) {
    try {
      // Support device as IP string or object with ip
      const deviceIp = typeof device === 'string' ? device : device.ip;
      // Get current data to fetch profile metadata first
      const syncDataText = await httpGet(deviceIp, '/dev/info.cgi?action=syncData');
      const deviceData = JSON.parse(decodeCustom(syncDataText));
      const currentIndex = (slot !== undefined && slot !== null) ? Number(slot) : (deviceData.peqSelect ?? 0);
      const profile = Array.isArray(deviceData.peq) ? deviceData.peq[currentIndex] : null;

      const luxFilters = (filters || []).map(f => ({
        type: toLuxsinType(f.type),
        fc: Number(f.freq ?? f.fc),
        gain: Number(f.gain),
        q: Number(f.q)
      }));

      const update = {
        peq: [{
          index: currentIndex,
          name: profile?.name || phoneObj?.fileName || `Profile ${currentIndex}`,
          canDel: profile?.canDel ?? 1,
          preamp: Number(preamp ?? profile?.preamp ?? 0),
          filters: JSON.stringify(luxFilters)
        }]
      };

      await httpPostJsonEncoded(deviceIp, '/dev/info.cgi', update);
      console.log('Luxsin: PEQ updated successfully');
      return false; // no restart required
    } catch (err) {
      console.error('Luxsin: error pushing to device', err);
      throw err;
    }
  }

  async function enablePEQ(device, enabled, slotId) {
    try {
      const payload = { peqEnable: enabled ? 1 : 0 };
      if (slotId !== undefined && slotId !== null) payload.peqSelect = Number(slotId);
      await httpPostJsonEncoded(device.ip, '/dev/info.cgi', payload);
      console.log(`Luxsin: PEQ ${enabled ? 'enabled' : 'disabled'}${slotId !== undefined ? ` on slot ${slotId}` : ''}`);
    } catch (err) {
      console.error('Luxsin: error toggling PEQ', err);
      throw err;
    }
  }

  async function getCurrentSlot(device) {
    try {
      const text = await httpGet(device.ip, '/dev/info.cgi?action=syncPeq');
      const data = JSON.parse(decodeCustom(text));
      return data.peqSelect ?? 0;
    } catch (err) {
      console.warn('Luxsin: getCurrentSlot failed, defaulting to 0', err);
      return 0;
    }
  }

  async function getAvailableSlots(device) {
    try {
      const text = await httpGet(device.ip, '/dev/info.cgi?action=syncPeq');
      const data = JSON.parse(decodeCustom(text));
      const peq = Array.isArray(data.peq) ? data.peq : [];
      return peq.map((p, idx) => ({ id: idx, name: p.name || `Profile ${idx}` }));
    } catch (err) {
      console.warn('Luxsin: getAvailableSlots failed, returning empty list', err);
      return [];
    }
  }

  return {
    getCurrentSlot,
    getAvailableSlots,
    pullFromDevice,
    pushToDevice,
    enablePEQ,
  };
})();
