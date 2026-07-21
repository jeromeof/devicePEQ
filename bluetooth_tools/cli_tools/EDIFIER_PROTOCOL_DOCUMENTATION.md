# Edifier W830NB Protocol Documentation
## Comprehensive Guide for Web Bluetooth Implementation

---

## Table of Contents
1. [Overview](#overview)
2. [Protocol Architecture](#protocol-architecture)
3. [Packet Structure](#packet-structure)
4. [Command Reference](#command-reference)
5. [PEQ (Parametric EQ) Implementation](#peq-parametric-eq-implementation)
6. [Web Bluetooth Implementation](#web-bluetooth-implementation)
7. [JavaScript Implementation Examples](#javascript-implementation-examples)
8. [Testing and Debugging](#testing-and-debugging)

---

## Overview

### Protocol Type
- **Name**: Edifier Custom Protocol (NOT Airoha RACE)
- **Transport**: Bluetooth Low Energy (GATT) or SPP (Serial Port Profile)
- **Manufacturer ID**: 2016 (0x07E0)
- **Supported Models**: W830NB, and other Edifier ConnectX devices

### Key Characteristics
- Proprietary protocol developed by Edifier
- Two protocol versions (V1 legacy, V2 current)
- Command-response architecture
- CRC checksums for data integrity
- Optional payload encryption

---

## Protocol Architecture

### Connection Methods

#### 1. BLE (Bluetooth Low Energy) - Primary
- Uses GATT services and characteristics
- Default MTU: 20 bytes (can be negotiated higher)
- Supports both read and write operations

#### 2. SPP (Serial Port Profile) - Secondary
- **UUID**: `EDF00000-EDFE-DFED-FEDF-EDFEDFEDFEDF`
- RFCOMM-based serial communication
- Not accessible from Web Bluetooth (Chrome limitation)

### Protocol Versions

#### BLE Version 1 (Legacy)
```
Total: 4 + payload_length + 2 bytes
[Header] [Length] [Command] [Payload...] [CRC_High] [CRC_Low]
```

#### BLE Version 2 (Current - W830NB uses this)
```
Total: 6 + payload_length bytes
[Header] [AppCode] [Command] [Len_High] [Len_Low] [Payload...] [CRC]
```

---

## Packet Structure

### Version 2 Packet Format (W830NB)

| Byte Index | Field | Size | Description | Example |
|------------|-------|------|-------------|---------|
| 0 | Header | 1 byte | Packet type identifier | 0xBB (send) / 0xCC (receive) |
| 1 | AppCode | 1 byte | Application identifier | 0xEC (236) |
| 2 | Command | 1 byte | Command index | 0x43 (67 = get EQ) |
| 3-4 | Length | 2 bytes | Payload length (big-endian) | 0x00 0x0A (10 bytes) |
| 5...N-1 | Payload | Variable | Command-specific data | [see commands] |
| N | CRC | 1 byte | Checksum (8-bit) | Calculated value |

### Header Values
- **0xBB (187)**: Commands sent TO device
- **0xCC (204)**: Responses FROM device
- **0xAA (170)**: Alternative command header (rarely used)

### AppCode
- **0xEC (236)**: Standard application code for ConnectX protocol

---

## CRC Calculation

### Version 2 CRC (8-bit)
```javascript
function calculateCRC_V2(dataArray) {
    // CRC is sum of all bytes (excluding CRC itself) & 0xFF
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    return sum & 0xFF;
}
```

### Version 1 CRC (16-bit) - For Reference
```javascript
function calculateCRC_V1(dataArray) {
    // CRC base: 0x2019 (8217)
    let sum = 0x2019;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const high = (sum >> 8) & 0xFF;
    const low = sum & 0xFF;
    return [high, low];
}
```

---

## Command Reference

### Essential Commands for W830NB

| Command Name | Index (Hex) | Index (Dec) | Direction | Description |
|--------------|-------------|-------------|-----------|-------------|
| **Battery Query** | 0xD0 | 208 | Send | Get battery level |
| **Version Query** | 0xC6 | 198 | Send | Get firmware version |
| **Device State** | 0xF2 | 242 | Send | Get connection state |
| **ANC Query** | 0xCC | 204 | Send | Get ANC mode |
| **ANC Set** | 0xC1 | 193 | Send | Set ANC mode |
| **EQ Query** | 0xD5 | 213 | Send | Get current EQ preset |
| **EQ Set** | 0xC4 | 196 | Send | Set EQ preset |
| **Custom EQ Query** | 0x43 | 67 | Send | Get custom EQ settings |
| **Custom EQ Set** | 0x44 | 68 | Send | Set single EQ band |
| **Custom EQ Full** | 0x46 | 70 | Send | Set complete EQ profile |
| **Custom EQ Reset** | 0x45 | 69 | Send | Reset EQ to default |
| **Volume Query** | 0x66 | 102 | Send | Get device volume |
| **Volume Set** | 0x67 | 103 | Send | Set device volume |

### Command Packet Examples

#### Example 1: Get Battery Level
```
Send: BB EC D0 00 00 AF
      ↑  ↑  ↑  ↑  ↑  ↑
      │  │  │  │  │  └─ CRC: (0xBB+0xEC+0xD0+0x00+0x00) & 0xFF = 0xAF
      │  │  │  └──└───── Length: 0 bytes payload
      │  │  └────────── Command: 0xD0 (battery query)
      │  └───────────── AppCode: 0xEC
      └──────────────── Header: 0xBB (send)

Receive: CC EC D0 00 01 64 6C
         ↑  ↑  ↑  ↑  ↑  ↑  ↑
         │  │  │  │  │  │  └─ CRC
         │  │  │  │  │  └──── Payload: 0x64 (100% battery)
         │  │  │  └──└─────── Length: 1 byte
         │  │  └───────────── Command: 0xD0 (response)
         │  └──────────────── AppCode: 0xEC
         └─────────────────── Header: 0xCC (receive)
```

#### Example 2: Set Volume to 50%
```
Send: BB EC 67 00 01 32 9F
      ↑  ↑  ↑  ↑  ↑  ↑  ↑
      │  │  │  │  │  │  └─ CRC
      │  │  │  │  │  └──── Payload: 0x32 (50 in decimal)
      │  │  │  └──└─────── Length: 1 byte
      │  │  └───────────── Command: 0x67 (volume set)
      │  └──────────────── AppCode: 0xEC
      └─────────────────── Header: 0xBB (send)
```

---

## PEQ (Parametric EQ) Implementation

### EQ Data Structures

#### SingleEqBand Structure
```javascript
class SingleEqBand {
    constructor() {
        this.band = 0;      // Band index (0-9)
        this.filter = 0;    // Filter type (0-7)
        this.freq = 0;      // Frequency in Hz (e.g., 100, 1000, 10000)
        this.gain = 0;      // Gain value (0-12, where 6 = 0dB)
        this.q = 0;         // Q value (bandwidth, 0-100)
    }
}
```

#### Gain Conversion
```javascript
// Gain encoding: 0-12 maps to -6dB to +6dB
// Formula: dB = (gain - 6)
// Examples:
//   gain=0  → -6dB
//   gain=6  →  0dB (neutral)
//   gain=12 → +6dB

function gainToDb(gain) {
    return gain - 6;
}

function dbToGain(db) {
    return db + 6;
}
```

### EQ Protocol Versions (eqIndex)

The W830NB likely uses **eqIndex = default (6-byte format)**:

#### Default Format (6 bytes per band)
```
[Band] [Filter] [Freq_High] [Freq_Low] [Gain] [Q_Value]
```

#### Example: 100Hz band with +3dB gain
```
Band 0: [0x00] [0x00] [0x00] [0x64] [0x09] [0x32]
         ↑     ↑     ↑      ↑      ↑     ↑
         │     │     │      │      │     └─ Q: 50 (0x32)
         │     │     │      │      └─────── Gain: 9 → +3dB
         │     │     └──────┴────────────── Freq: 100Hz (0x0064)
         │     └──────────────────────────── Filter: 0 (peak/bell)
         └────────────────────────────────── Band: 0
```

### Filter Types
```javascript
const FilterType = {
    PEAK: 0,        // Peak/Bell filter (most common)
    LOW_SHELF: 1,   // Low shelf
    HIGH_SHELF: 2,  // High shelf
    LOW_PASS: 3,    // Low pass filter
    HIGH_PASS: 4,   // High pass filter
    NOTCH: 5,       // Notch/Band-stop
    ALL_PASS: 6,    // All pass
    BAND_PASS: 7    // Band pass
};
```

### Common EQ Frequencies
```javascript
const CommonFrequencies = [
    32, 64, 125, 250, 500,      // Bass
    1000, 2000, 4000,            // Mids
    8000, 16000                  // Treble
];
```

### Reading Custom EQ

#### Command: Get Custom EQ (0x43)
```
Send: BB EC 43 00 00 32
```

#### Response Format
Response will contain all EQ bands (typically 10 bands = 60 bytes):
```
CC EC 43 00 3C [band0 6bytes] [band1 6bytes] ... [band9 6bytes] [CRC]
```

### Writing Single EQ Band

#### Command: Set Custom EQ Band (0x44)
```javascript
function setEqBand(bandIndex, filter, frequency, gain, qValue) {
    const freqHigh = (frequency >> 8) & 0xFF;
    const freqLow = frequency & 0xFF;

    const payload = [
        bandIndex,
        filter,
        freqHigh,
        freqLow,
        gain,
        qValue
    ];

    return buildCommand(0x44, payload);
}

// Example: Set band 0 to 1kHz, +3dB, Q=50
const packet = setEqBand(0, 0, 1000, 9, 50);
// Result: BB EC 44 00 06 00 00 03 E8 09 32 [CRC]
```

### Writing Complete EQ Profile

#### Command: Set Full EQ Profile (0x46)

This command requires:
1. All band data (6 bytes × 10 bands = 60 bytes)
2. Timestamp (4 bytes, reversed)
3. Profile name (UTF-8 encoded)

```javascript
function setFullEqProfile(bands, profileName) {
    // bands is array of 10 SingleEqBand objects
    let payload = [];

    // Add all band data
    for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        const freqHigh = (band.freq >> 8) & 0xFF;
        const freqLow = band.freq & 0xFF;

        payload.push(
            i,              // Band index
            band.filter,
            freqHigh,
            freqLow,
            band.gain,
            band.q
        );
    }

    // Add timestamp (4 bytes, little-endian)
    const timestamp = Date.now();
    payload.push(
        (timestamp >> 24) & 0xFF,
        (timestamp >> 16) & 0xFF,
        (timestamp >> 8) & 0xFF,
        timestamp & 0xFF
    );

    // Add profile name (UTF-8)
    const nameBytes = new TextEncoder().encode(profileName);
    payload.push(...nameBytes);

    return buildCommand(0x46, payload);
}
```

---

## Web Bluetooth Implementation

### Prerequisites

#### Browser Compatibility
- Chrome 56+ (desktop/Android)
- Edge 79+
- Opera 43+
- Samsung Internet 6.0+

**NOT supported in:**
- Firefox (no Web Bluetooth support)
- Safari (no Web Bluetooth support)
- iOS Chrome (uses Safari engine)

#### HTTPS Requirement
Web Bluetooth only works on:
- `https://` pages
- `http://localhost` (for testing)

### GATT Service Discovery

Since the exact UUIDs aren't in the decompiled source, you'll need to discover them:

#### Method 1: Manual Discovery
```javascript
async function discoverEdifierServices() {
    try {
        // Request device
        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: 'EDIFIER' },
                { namePrefix: 'W830NB' }
            ],
            optionalServices: ['generic_access', 'battery_service']
        });

        console.log('Device:', device.name);

        // Connect to GATT server
        const server = await device.gatt.connect();
        console.log('Connected to GATT server');

        // Get all services
        const services = await server.getPrimaryServices();

        for (const service of services) {
            console.log('Service:', service.uuid);

            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                console.log('  Characteristic:', char.uuid);
                console.log('    Properties:', char.properties);
            }
        }
    } catch (error) {
        console.error('Discovery error:', error);
    }
}
```

#### Expected Service/Characteristic Pattern
Based on Edifier's SPP UUID pattern, BLE services likely use:
- Service UUID pattern: `EDF0****-EDFE-DFED-FEDF-EDFEDFEDFEDF`
- Possible service numbers:
  - `EDF00001-...` (main service)
  - `EDF0FFF0-...` (alternative)

Common characteristics:
- **TX (Transmit)**: Write property for sending commands
- **RX (Receive)**: Notify property for receiving responses

### Connection Flow

```javascript
class EdifierW830NB {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
        this.responseCallback = null;
    }

    async connect() {
        try {
            // Step 1: Request device
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'EDIFIER' },
                    { namePrefix: 'W830NB' }
                ],
                optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb'] // Common BLE UART service
            });

            console.log('Selected device:', this.device.name);

            // Step 2: Connect to GATT
            this.server = await this.device.gatt.connect();
            console.log('Connected to GATT server');

            // Step 3: Get primary service
            // TODO: Replace with actual UUID after discovery
            this.service = await this.server.getPrimaryService('0000fff0-0000-1000-8000-00805f9b34fb');

            // Step 4: Get characteristics
            // TODO: Replace with actual UUIDs after discovery
            this.txCharacteristic = await this.service.getCharacteristic('0000fff1-0000-1000-8000-00805f9b34fb');
            this.rxCharacteristic = await this.service.getCharacteristic('0000fff2-0000-1000-8000-00805f9b34fb');

            // Step 5: Subscribe to notifications
            await this.rxCharacteristic.startNotifications();
            this.rxCharacteristic.addEventListener('characteristicvaluechanged',
                this.handleNotification.bind(this));

            console.log('✓ Connected and subscribed to notifications');
            return true;

        } catch (error) {
            console.error('Connection error:', error);
            return false;
        }
    }

    handleNotification(event) {
        const value = event.target.value;
        const data = new Uint8Array(value.buffer);

        console.log('Received:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));

        if (this.responseCallback) {
            this.responseCallback(data);
        }
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
            console.log('Disconnected');
        }
    }
}
```

---

## JavaScript Implementation Examples

### Complete Implementation

```javascript
class EdifierProtocol {
    constructor() {
        this.HEADER_SEND = 0xBB;
        this.HEADER_RECEIVE = 0xCC;
        this.APP_CODE = 0xEC;

        // Command indices
        this.CMD = {
            BATTERY: 0xD0,
            VERSION: 0xC6,
            DEVICE_STATE: 0xF2,
            ANC_GET: 0xCC,
            ANC_SET: 0xC1,
            EQ_GET: 0xD5,
            EQ_SET: 0xC4,
            CUSTOM_EQ_GET: 0x43,
            CUSTOM_EQ_SET_BAND: 0x44,
            CUSTOM_EQ_RESET: 0x45,
            CUSTOM_EQ_SET_FULL: 0x46,
            VOLUME_GET: 0x66,
            VOLUME_SET: 0x67
        };
    }

    /**
     * Build a command packet
     * @param {number} commandIndex - Command byte (e.g., 0x43)
     * @param {Array<number>} payload - Payload bytes
     * @returns {Uint8Array} Complete packet with CRC
     */
    buildCommand(commandIndex, payload = []) {
        const payloadLength = payload.length;
        const lengthHigh = (payloadLength >> 8) & 0xFF;
        const lengthLow = payloadLength & 0xFF;

        // Build packet without CRC
        const packet = [
            this.HEADER_SEND,
            this.APP_CODE,
            commandIndex,
            lengthHigh,
            lengthLow,
            ...payload
        ];

        // Calculate and append CRC
        const crc = this.calculateCRC(packet);
        packet.push(crc);

        return new Uint8Array(packet);
    }

    /**
     * Calculate CRC-8 checksum
     * @param {Array<number>} data - Data bytes (without CRC)
     * @returns {number} CRC byte
     */
    calculateCRC(data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
        }
        return sum & 0xFF;
    }

    /**
     * Verify received packet CRC
     * @param {Uint8Array} packet - Complete packet including CRC
     * @returns {boolean} True if CRC is valid
     */
    verifyCRC(packet) {
        if (packet.length < 6) return false;

        const dataWithoutCrc = Array.from(packet.slice(0, -1));
        const receivedCrc = packet[packet.length - 1];
        const calculatedCrc = this.calculateCRC(dataWithoutCrc);

        return receivedCrc === calculatedCrc;
    }

    /**
     * Parse received packet
     * @param {Uint8Array} packet - Raw packet data
     * @returns {Object} Parsed packet object
     */
    parseResponse(packet) {
        if (packet.length < 6) {
            return { error: 'Packet too short' };
        }

        if (!this.verifyCRC(packet)) {
            return { error: 'CRC check failed' };
        }

        const header = packet[0];
        const appCode = packet[1];
        const command = packet[2];
        const lengthHigh = packet[3];
        const lengthLow = packet[4];
        const payloadLength = (lengthHigh << 8) | lengthLow;
        const payload = packet.slice(5, 5 + payloadLength);
        const crc = packet[packet.length - 1];

        return {
            header,
            appCode,
            command,
            payloadLength,
            payload: Array.from(payload),
            crc,
            valid: header === this.HEADER_RECEIVE
        };
    }

    // ===== Simple Commands =====

    getBattery() {
        return this.buildCommand(this.CMD.BATTERY);
    }

    getVersion() {
        return this.buildCommand(this.CMD.VERSION);
    }

    getVolume() {
        return this.buildCommand(this.CMD.VOLUME_GET);
    }

    setVolume(level) {
        // level: 0-100
        return this.buildCommand(this.CMD.VOLUME_SET, [level & 0xFF]);
    }

    getANC() {
        return this.buildCommand(this.CMD.ANC_GET);
    }

    setANC(mode, value = 0, progress = 0) {
        // mode: ANC mode (device-specific)
        // value: ANC level
        // progress: ANC strength (if supported)
        const payload = progress > 0 ? [mode, value, progress] : [mode, value];
        return this.buildCommand(this.CMD.ANC_SET, payload);
    }

    // ===== EQ Commands =====

    getEQ() {
        return this.buildCommand(this.CMD.EQ_GET);
    }

    setEQPreset(presetIndex) {
        return this.buildCommand(this.CMD.EQ_SET, [presetIndex]);
    }

    getCustomEQ() {
        return this.buildCommand(this.CMD.CUSTOM_EQ_GET);
    }

    setCustomEQBand(bandIndex, filter, frequency, gain, qValue) {
        const freqHigh = (frequency >> 8) & 0xFF;
        const freqLow = frequency & 0xFF;

        const payload = [
            bandIndex & 0xFF,
            filter & 0xFF,
            freqHigh,
            freqLow,
            gain & 0xFF,
            qValue & 0xFF
        ];

        return this.buildCommand(this.CMD.CUSTOM_EQ_SET_BAND, payload);
    }

    resetCustomEQ() {
        return this.buildCommand(this.CMD.CUSTOM_EQ_RESET);
    }

    setCustomEQProfile(bands, profileName = 'Custom') {
        // bands: array of 10 band objects
        let payload = [];

        // Add each band (6 bytes each)
        for (let i = 0; i < bands.length; i++) {
            const band = bands[i];
            const freqHigh = (band.freq >> 8) & 0xFF;
            const freqLow = band.freq & 0xFF;

            payload.push(
                i,
                band.filter & 0xFF,
                freqHigh,
                freqLow,
                band.gain & 0xFF,
                band.q & 0xFF
            );
        }

        // Add timestamp (4 bytes, big-endian)
        const timestamp = Math.floor(Date.now() / 1000);
        payload.push(
            (timestamp >> 24) & 0xFF,
            (timestamp >> 16) & 0xFF,
            (timestamp >> 8) & 0xFF,
            timestamp & 0xFF
        );

        // Add profile name (UTF-8)
        const encoder = new TextEncoder();
        const nameBytes = encoder.encode(profileName);
        payload.push(...nameBytes);

        return this.buildCommand(this.CMD.CUSTOM_EQ_SET_FULL, payload);
    }

    // ===== Response Parsers =====

    parseBatteryResponse(payload) {
        if (payload.length >= 1) {
            return {
                level: payload[0],
                percentage: payload[0]
            };
        }
        return null;
    }

    parseVolumeResponse(payload) {
        if (payload.length >= 1) {
            return {
                level: payload[0]
            };
        }
        return null;
    }

    parseCustomEQResponse(payload) {
        // Expected: 60 bytes (10 bands × 6 bytes each)
        if (payload.length < 60) {
            return { error: 'Invalid EQ data length' };
        }

        const bands = [];
        for (let i = 0; i < 10; i++) {
            const offset = i * 6;
            const band = {
                index: payload[offset],
                filter: payload[offset + 1],
                freq: (payload[offset + 2] << 8) | payload[offset + 3],
                gain: payload[offset + 4],
                q: payload[offset + 5],
                gainDb: payload[offset + 4] - 6
            };
            bands.push(band);
        }

        return { bands };
    }
}
```

### Complete W830NB Controller Class

```javascript
class EdifierW830NBController {
    constructor() {
        this.device = null;
        this.server = null;
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
        this.protocol = new EdifierProtocol();
        this.responseQueue = [];
        this.waitingForResponse = false;
        this.currentCommand = null;
    }

    async connect() {
        try {
            console.log('Requesting Bluetooth device...');

            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'EDIFIER' },
                    { namePrefix: 'W830NB' }
                ],
                optionalServices: [
                    '0000fff0-0000-1000-8000-00805f9b34fb' // Common UART service
                ]
            });

            console.log('Device selected:', this.device.name);

            this.server = await this.device.gatt.connect();
            console.log('GATT server connected');

            // Get service (update UUID after discovery)
            const service = await this.server.getPrimaryService('0000fff0-0000-1000-8000-00805f9b34fb');

            // Get characteristics (update UUIDs after discovery)
            this.txCharacteristic = await service.getCharacteristic('0000fff1-0000-1000-8000-00805f9b34fb');
            this.rxCharacteristic = await service.getCharacteristic('0000fff2-0000-1000-8000-00805f9b34fb');

            // Subscribe to notifications
            await this.rxCharacteristic.startNotifications();
            this.rxCharacteristic.addEventListener('characteristicvaluechanged',
                this.handleNotification.bind(this));

            console.log('✓ Connected successfully');
            return true;

        } catch (error) {
            console.error('Connection failed:', error);
            throw error;
        }
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
            console.log('Disconnected');
        }
    }

    handleNotification(event) {
        const value = event.target.value;
        const data = new Uint8Array(value.buffer);

        console.log('RX:', Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

        const parsed = this.protocol.parseResponse(data);
        console.log('Parsed:', parsed);

        this.responseQueue.push(parsed);
    }

    async sendCommand(commandPacket, waitForResponse = true) {
        if (!this.txCharacteristic) {
            throw new Error('Not connected');
        }

        console.log('TX:', Array.from(commandPacket).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

        this.responseQueue = [];
        await this.txCharacteristic.writeValue(commandPacket);

        if (waitForResponse) {
            // Wait for response (timeout after 5 seconds)
            const startTime = Date.now();
            while (this.responseQueue.length === 0 && Date.now() - startTime < 5000) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (this.responseQueue.length > 0) {
                return this.responseQueue[0];
            } else {
                throw new Error('Response timeout');
            }
        }
    }

    // === High-level API ===

    async getBattery() {
        const cmd = this.protocol.getBattery();
        const response = await this.sendCommand(cmd);
        return this.protocol.parseBatteryResponse(response.payload);
    }

    async getVolume() {
        const cmd = this.protocol.getVolume();
        const response = await this.sendCommand(cmd);
        return this.protocol.parseVolumeResponse(response.payload);
    }

    async setVolume(level) {
        const cmd = this.protocol.setVolume(level);
        await this.sendCommand(cmd);
    }

    async getCustomEQ() {
        const cmd = this.protocol.getCustomEQ();
        const response = await this.sendCommand(cmd);
        return this.protocol.parseCustomEQResponse(response.payload);
    }

    async setEQBand(bandIndex, frequency, gainDb, qValue = 50) {
        const gain = gainDb + 6; // Convert dB to 0-12 scale
        const filter = 0; // Peak filter

        const cmd = this.protocol.setCustomEQBand(bandIndex, filter, frequency, gain, qValue);
        await this.sendCommand(cmd);
    }

    async resetEQ() {
        const cmd = this.protocol.resetCustomEQ();
        await this.sendCommand(cmd);
    }
}
```

---

## Testing and Debugging

### Basic HTML Test Page

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edifier W830NB Controller</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin: 5px;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .status {
            padding: 15px;
            margin: 20px 0;
            border-radius: 5px;
            background: #e7f3ff;
            border-left: 4px solid #007bff;
        }
        .error {
            background: #ffe7e7;
            border-left-color: #dc3545;
        }
        .success {
            background: #e7ffe7;
            border-left-color: #28a745;
        }
        .log {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 15px;
            max-height: 300px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            margin-top: 20px;
        }
        .slider-container {
            margin: 20px 0;
        }
        .slider {
            width: 100%;
            margin: 10px 0;
        }
        .eq-controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .eq-band {
            text-align: center;
        }
        .eq-band input {
            width: 100%;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎧 Edifier W830NB Controller</h1>

        <div id="status" class="status">
            Not connected
        </div>

        <div>
            <button id="connectBtn" onclick="connect()">Connect</button>
            <button id="disconnectBtn" onclick="disconnect()" disabled>Disconnect</button>
        </div>

        <hr style="margin: 30px 0;">

        <h2>Device Info</h2>
        <div>
            <button onclick="getBattery()">Get Battery</button>
            <button onclick="getVolume()">Get Volume</button>
        </div>

        <h2>Volume Control</h2>
        <div class="slider-container">
            <input type="range" min="0" max="100" value="50" class="slider" id="volumeSlider">
            <span id="volumeValue">50%</span>
            <button onclick="setVolume()">Set Volume</button>
        </div>

        <h2>EQ Control</h2>
        <div>
            <button onclick="getEQ()">Get Custom EQ</button>
            <button onclick="resetEQ()">Reset EQ</button>
        </div>

        <div class="eq-controls" id="eqControls">
            <!-- EQ sliders will be added here -->
        </div>

        <h2>Debug Log</h2>
        <div id="log" class="log"></div>
    </div>

    <script src="edifier-protocol.js"></script>
    <script src="edifier-controller.js"></script>
    <script>
        let controller = new EdifierW830NBController();

        // Setup volume slider
        document.getElementById('volumeSlider').oninput = function() {
            document.getElementById('volumeValue').textContent = this.value + '%';
        };

        function log(message, type = 'info') {
            const logDiv = document.getElementById('log');
            const timestamp = new Date().toLocaleTimeString();
            logDiv.innerHTML += `<div>[${timestamp}] ${message}</div>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        function setStatus(message, type = 'info') {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = message;
            statusDiv.className = 'status ' + type;
        }

        async function connect() {
            try {
                log('Connecting...');
                await controller.connect();
                setStatus('Connected to ' + controller.device.name, 'success');
                log('Connected successfully', 'success');

                document.getElementById('connectBtn').disabled = true;
                document.getElementById('disconnectBtn').disabled = false;

                // Auto-fetch battery
                setTimeout(getBattery, 500);

            } catch (error) {
                setStatus('Connection failed: ' + error.message, 'error');
                log('Error: ' + error.message, 'error');
            }
        }

        async function disconnect() {
            await controller.disconnect();
            setStatus('Disconnected', 'info');
            log('Disconnected');

            document.getElementById('connectBtn').disabled = false;
            document.getElementById('disconnectBtn').disabled = true;
        }

        async function getBattery() {
            try {
                log('Getting battery level...');
                const battery = await controller.getBattery();
                log(`Battery: ${battery.percentage}%`);
                alert(`Battery: ${battery.percentage}%`);
            } catch (error) {
                log('Error: ' + error.message, 'error');
            }
        }

        async function getVolume() {
            try {
                log('Getting volume...');
                const volume = await controller.getVolume();
                log(`Volume: ${volume.level}`);
                document.getElementById('volumeSlider').value = volume.level;
                document.getElementById('volumeValue').textContent = volume.level + '%';
            } catch (error) {
                log('Error: ' + error.message, 'error');
            }
        }

        async function setVolume() {
            try {
                const level = parseInt(document.getElementById('volumeSlider').value);
                log(`Setting volume to ${level}...`);
                await controller.setVolume(level);
                log('Volume set successfully');
            } catch (error) {
                log('Error: ' + error.message, 'error');
            }
        }

        async function getEQ() {
            try {
                log('Getting EQ settings...');
                const eq = await controller.getCustomEQ();
                log('EQ settings received');

                // Display EQ bands
                const eqDiv = document.getElementById('eqControls');
                eqDiv.innerHTML = '';

                eq.bands.forEach((band, i) => {
                    const bandDiv = document.createElement('div');
                    bandDiv.className = 'eq-band';
                    bandDiv.innerHTML = `
                        <label>${band.freq}Hz</label>
                        <input type="range" min="-6" max="6" value="${band.gainDb}"
                               onchange="updateEQBand(${i}, ${band.freq}, this.value)">
                        <div>${band.gainDb}dB</div>
                    `;
                    eqDiv.appendChild(bandDiv);
                });

            } catch (error) {
                log('Error: ' + error.message, 'error');
            }
        }

        async function updateEQBand(bandIndex, frequency, gainDb) {
            try {
                log(`Setting band ${bandIndex} (${frequency}Hz) to ${gainDb}dB...`);
                await controller.setEQBand(bandIndex, frequency, parseFloat(gainDb));
                log('Band updated successfully');
            } catch (error) {
                log('Error: ' + error.message, 'error');
            }
        }

        async function resetEQ() {
            try {
                log('Resetting EQ...');
                await controller.resetEQ();
                log('EQ reset successfully');
                setTimeout(getEQ, 500);
            } catch (error) {
                log('Error: ' + error.message, 'error');
            }
        }
    </script>
</body>
</html>
```

### Debugging Steps

#### 1. Service Discovery
First, discover the actual UUIDs:
```javascript
// Run this in console after connecting
async function discoverAll() {
    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['generic_access', 'battery_service']
    });

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();

    for (const service of services) {
        console.log(`Service: ${service.uuid}`);
        const chars = await service.getCharacteristics();
        for (const char of chars) {
            console.log(`  Char: ${char.uuid}`, char.properties);
        }
    }
}
```

#### 2. Packet Sniffing
Use Android's Bluetooth HCI log:
1. Enable Developer Options on Android
2. Enable "Bluetooth HCI snoop log"
3. Use the Edifier app
4. Extract log: `/sdcard/Android/data/btsnoop_hci.log`
5. Open in Wireshark

#### 3. Common Issues

**Issue**: Device not found
- **Solution**: Ensure headphones are in pairing mode
- Check device name (may be "W830NB" or "EDIFIER W830NB")

**Issue**: Can't connect to GATT
- **Solution**: Headphones may need to be unpaired from phone first

**Issue**: Service not found
- **Solution**: Use `optionalServices: []` to discover all services
- Update UUIDs after discovery

**Issue**: No response from commands
- **Solution**: Check TX/RX characteristic UUIDs
- Verify packet structure with HCI log
- Ensure notifications are enabled on RX characteristic

---

## Next Steps

### Required Actions

1. **Discover UUIDs**
   - Run service discovery script
   - Document actual service and characteristic UUIDs
   - Update code with correct UUIDs

2. **Verify Protocol**
   - Send simple commands (battery, volume)
   - Capture and verify responses
   - Confirm packet structure matches documentation

3. **Test EQ Commands**
   - Read current EQ settings
   - Modify single band
   - Verify changes on headphones
   - Test full profile update

4. **Handle Edge Cases**
   - Test with empty EQ profiles
   - Verify max payload sizes
   - Test disconnection/reconnection
   - Handle packet fragmentation (if MTU < packet size)

### Useful Resources

- **Web Bluetooth API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- **Bluetooth GATT**: https://www.bluetooth.com/specifications/gatt/
- **Wireshark**: https://www.wireshark.org/
- **nRF Connect**: Play Store app for Bluetooth debugging

---

## Appendix

### Common Frequencies for 10-Band EQ
```javascript
const standardBands = [
    { freq: 32, name: 'Sub Bass' },
    { freq: 64, name: 'Bass' },
    { freq: 125, name: 'Bass' },
    { freq: 250, name: 'Low Mids' },
    { freq: 500, name: 'Mids' },
    { freq: 1000, name: 'Mids' },
    { freq: 2000, name: 'High Mids' },
    { freq: 4000, name: 'Presence' },
    { freq: 8000, name: 'Brilliance' },
    { freq: 16000, name: 'Air' }
];
```

### Error Codes
Monitor response payloads for error indicators:
- Response with 0-length payload may indicate error
- Check if command echo matches sent command
- Verify header is 0xCC for valid responses

### MTU Considerations
- Default MTU: 23 bytes (20 bytes usable)
- Command packets > 20 bytes may require:
  - MTU negotiation (`requestMTU()` - not in Web Bluetooth)
  - Packet fragmentation
  - Multiple writes with delays

For full EQ profile (70+ bytes), you may need to:
1. Send in chunks of 20 bytes
2. Use continuation commands
3. Or use MTU negotiation if supported

---

**Document Version**: 1.0
**Last Updated**: 2025
**Target Device**: Edifier W830NB
**Protocol Version**: BLE V2

---

## License Note

This documentation is based on reverse engineering of publicly available decompiled source code for educational and interoperability purposes. Use responsibly and respect intellectual property rights.
