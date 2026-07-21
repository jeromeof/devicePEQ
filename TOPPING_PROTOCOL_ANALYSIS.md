# Topping Home JS Protocol Analysis

## File Locations
- Protocol defs: /Users/joflaherty/Downloads/topping-home-js/0cd599ac99fc4c0c.js
- Device logic: /Users/joflaherty/Downloads/topping-home-js/34c6de754947383b.js

## Key Command Codes (from 0cd599ac99fc4c0c.js)

### Frame Protocol Types
- readAck: 17
- readNack: 16  
- rAck: 31
- writeAck: 33
- writeNack: 32
- wAck: 47

### Command IDs
- connectState: 4353
- heartbeat: 4378
- eqPreview: 4379
- eqPreviewState: 4380
- agreementConfig: 4384
- upload: 4358
- sampling: 4359
- dataMute: 4361
- deleteConfig: 4362
- downloadSingleConfig: 4363
- renameConfigIndex: 4364
- renameConfigName: 4365
- switchMcuConfig: 4366
- deviceSaveIndex: 4367
- deviceSaveConfig: 4368
- dx5iiShutdownState: 4369
- eqUi: 4370
- deviceE50Config: 4377
- hardwareVersion: 4609
- softwareVersion: 4610
- deviceId: 4611
- mcuEqEnableState: 4612
- mcuEqCurrentConfig: 4614 ← KEY for EQ config read
- usbSerial: 4615

## EQ Band Encoding (from 34c6de754947383b.js)

### Band Data Structure
- 11 bands per channel (L and R)
- Total 22 bands
- Default freq: 632 Hz
- Default Q: 0.707

### Single Band Encoding
```
function r(e){
  return (255&!!e.enabled | (255&(255&e.type))<<8 | (255&(gain_bits))<<16)>>>0
}
```

Where gain_bits is calculated as:
```
let t = Number.isFinite(e.gainDb) ? e.gainDb : 0
t < -12 && (t = -12)
t > 12 && (t = 12)
i = Math.round(10*t)
i < -128 && (i = -128)
i > 127 && (i = 127)
255&i
```

### Band Decoding
```
function l(e,t,i){
  let n = e>>16&255
  return {
    enabled:(255&e)==1,
    type: e>>8&255,
    gainDb: (n>127 ? n-256 : n)/10,
    freqHz: t>>>0,
    q: (i>>>0)/1e4
  }
}
```

### Frequency Encoding
- Raw 32-bit unsigned: (freqHz ??? 632)>>>0
- Decoded: t>>>0 (unsigned 32-bit)
- Range checked: Math.max(20, Math.min(2e4, ...))

### Q Factor Encoding  
- Encoded: Math.round((q ?? 0.707) * 1e4) >>> 0
- Decoded: (i >>> 0) / 1e4
- Multiplier: 10000 (1e4)

### Global Gain (Preamp) Encoding
```
function a(e){
  let n = Math.round(10*Math.abs(e))
  // Lookup table encoding based on gain value
  return n>=0 ? (i[Math.min(n,i.length-1)]??i[0]??0x2000000)>>>0
              : (t[Math.min(n,t.length-1)]??t[0]??0x2000000)>>>0
}
```
Uses precomputed lookup tables for encoding gain values.

## Config Serialization (from 34c6de754947383b.js)

### Full Config Structure
```javascript
{
  name: string (0-15 chars),
  filterNum: 0-255 (default 11),
  enabledL: boolean,
  enabledR: boolean, 
  preampGainL: number (dB, -12 to +12),
  preampGainR: number (dB, -12 to +12),
  bandsL: Array[11] of band,
  bandsR: Array[11] of band
}
```

### Serialization Order
1. Name (4 × 32-bit words, 16 bytes)
2. enabledL (1 byte)
3. preampGainL (encoded via lookup table)
4. enabledR (1 byte)
5. preampGainR (encoded via lookup table)
6. For each of 11 left bands:
   - Packed 32-bit: enabled|type<<8|gain<<16
   - Frequency (32-bit unsigned)
   - Q factor (32-bit: q*10000)
7. For each of 11 right bands: (same as left)
8. Padding: 4 zero bytes

Total: 4 + 1 + 4 + 1 + 4 + 11*(4+4+4) + 11*(4+4+4) + 4 = 196 bytes per config

## Multiframe Response Assembly (class d)

### Buffer Management
```javascript
class d {
  buffer = new Map();
  expectedConfigCount = null;
  metadataFrame1Value = null;
  collectedConfigs = 0;
  configFrameLen = null;
  finished = false;
  hasEmittedSnapshot = false;
  
  applyFrame(e) {
    let t = e.totalFrameLen;
    let i = e.curFrame;
    
    if (2 === t) {
      // Metadata frames (2 total)
      if (0 === i && hasEmitted) reset();
      if (0 === i) expectedConfigCount = e.data;
      if (1 === i) metadataFrame1Value = e.data;
      return null;
    }
    
    if (t >= 70) {
      // Config frames (70+ frames total)
      if (!configFrameLen) configFrameLen = t;
      
      buffer.set(collectedConfigs*configFrameLen + i, e.data>>>0);
      
      if (i === t-1) {
        collectedConfigs++;
        if (collectedConfigs >= expectedConfigCount) {
          return buildResultSnapshot();
        }
      }
    }
    return null;
  }
}
```

### Response Assembly Logic
- Metadata comes first in 2-frame response
- Frame 0 of metadata contains expectedConfigCount (unsigned 32-bit)
- Frame 1 of metadata contains metadataFrame1Value
- Config follows in frames with totalFrameLen >= 70
- Each config takes configFrameLen frames
- Frames tracked by: collectedConfigs * frameLength + currentFrame

## Device Initialization Sequence (from h function)

```javascript
async function c(e, i){
  // Announce connection
  if (i?.announceConnection !== false) {
    await e(connectState, 2, {protocolType: writeNack})
    await delay(80)
  }
  
  // Get settings
  await e(dx5iiGetSettings, 0, {protocolType: readNack})
  await delay(30)
  
  // Get sampling
  await e(dx5iiGetSampling, 0, {protocolType: writeNack})
  await delay(20)
  
  // Request PEQ preview state
  await u(e)  // eqPreviewState command
}
```

## EQ Write Sequence (function h - 39937-39940 commands)

Commands sent in order:
1. 39937: setPreampGainL = encodeGlobalGain(preampGainL)
2. 39938: setEnabledL = (enabledL ? 1 : 0)
3. 39939: setPreampGainR = encodeGlobalGain(preampGainR)
4. 39940: setEnabledR = (enabledR ? 1 : 0)

Then for each of 11 bands:
- Command base: c = (36864 | ((i+1)&255)<<8) >>> 0
  - This creates base cmd 0x9000 | (bandNum << 8)
  
- For LEFT channel:
  - (1|c): type
  - (2|c): frequency
  - (3|c): gain
  - (4|c): Q factor  
  - (5|c): enabled
  
- For RIGHT channel:
  - (6|c): type
  - (7|c): frequency
  - (8|c): gain
  - (9|c): Q factor
  - (10|c): enabled

Wait 10ms after every 2 bands (i%2==1).


## HID Frame Format (buildHidFrame function - file 0cd599ac99fc4c0c.js)

### Frame Structure (16 bytes)
```
Byte  Content
----  -------
 0    0x00 (reserved)
 1    0x22 (0x22)
 2    0x33 (0x33)
 3    protocolType (readNack=16, readAck=17, writeNack=32, etc.)
 4    totalFrameLen (number of frames in multiframe message)
 5    curFrame (current frame index, 0-based)
 6    cmd[High] (command ID high byte)
 7    cmd[Low]  (command ID low byte)
 8    data[MSB]
 9    data[byte2]
10    data[byte1]
11    data[LSB]
12    crc[High] (if includeCrc=true, else 0x00)
13    crc[Low]  (if includeCrc=true, else 0x00)
14    0x66 (0x66)
15    0x77 (0x77)
```

### Frame Building Code (function p)
```javascript
function p(e){
  let t=new Uint8Array(16),n=e.totalFrameLen??1,r=e.curFrame??1;
  t[0]=0;
  t[1]=34;        // 0x22
  t[2]=51;        // 0x33
  t[3]=255&e.protocolType;
  t[4]=255&n;     // totalFrameLen
  t[5]=255&r;     // curFrame
  t[6]=e.cmd>>8&255;    // cmd high
  t[7]=255&e.cmd;       // cmd low
  let i=e.data>>>0;
  t[8]=i>>24&255;       // data MSB
  t[9]=i>>16&255;
  t[10]=i>>8&255;
  t[11]=255&i;          // data LSB
  
  if(e.includeCrc){
    // CRC16 calculation over bytes 3-11
    let e=function(e,t,n){
      let r=65535;  // CRC start = 0xFFFF
      for(let t=3;t<12;t+=1){
        r^=e[t]??0;
        for(let e=0;e<8;e+=1)
          r=((1&r)==1 ? r>>1^40961 : r>>1) & 65535  // Poly = 0xA001
      }
      return r
    }(t,3,12);
    t[12]=e>>8&255;
    t[13]=255&e;
  } else {
    t[12]=0;
    t[13]=0;
  }
  t[14]=102;      // 0x66
  t[15]=119;      // 0x77
  return t;
}
```

### CRC Polynomial
- Type: CRC-16
- Polynomial: 0xA001 (reversed)
- Initial value: 0xFFFF
- Calculation: XOR data bytes 3-11, process 8 bits per byte

### Frame Parsing Code (function m)
```javascript
function m(e,t=0){
  if(e.length<15)return null;
  
  // First variant: startByte at index 0
  if(34===e[0]&&51===e[1]){
    if(e.length<15||102!==e[13]||119!==e[14])return null;
    let n=e[2],r=e[3],i=e[4];
    return{
      reportId:t,
      protocolType:n,
      totalFrameLen:r,
      curFrame:i,
      cmd:e[5]<<8|e[6],
      data:(e[7]<<24|e[8]<<16|e[9]<<8|e[10])>>>0
    }
  }
  
  // Second variant: with reportId prepended (reportId at index 0)
  if(e.length>=16&&34===e[1]&&51===e[2]){
    if(102!==e[14]||119!==e[15])return null;
    let t=e[3],n=e[4],r=e[5],i=e[6]<<8|e[7],o=(e[8]<<24|e[9]<<16|e[10]<<8|e[11])>>>0;
    return{
      reportId:e[0],
      protocolType:t,
      totalFrameLen:n,
      curFrame:r,
      cmd:i,
      data:o
    }
  }
  return null;
}
```

### Frame Marker Detection
- Start bytes: 0x22, 0x33 (either at offset 0 or 1)
- End bytes: 0x66, 0x77 (at offset 14-15 or 15-16)

## Device Initialization on E50II (Non-DX5II Mode)

From tP() function in file 0cd599ac99fc4c0c.js:

```javascript
// Open device
await e.open();
await delay(120ms);

// Announce connection
await sendRawCommand(connectState, 1, {protocolType: writeNack});
await delay(100ms);

// Agreement/handshake
await sendRawCommand(agreementConfig, 1, {protocolType: writeNack});
await delay(100ms);

// Get EQ enable state
await sendRawCommand(mcuEqEnableState, 0, {protocolType: readNack});
await delay(50ms);
await delay(200ms);

// Get upload/config info
await sendRawCommand(upload, 0, {protocolType: readNack});
```

## Key Command IDs for EQ Operations

### DX5II (28929-28983 range)
- dx5iiGetSettings: 28940
- dx5iiGetSampling: 28943
- dx5iiPeqPreviewState: 28983
- dx5iiPeqState: 28978

### E50II/DX1II (4000-4600 range)
- eqPreviewState: 4380
- mcuEqEnableState: 4612
- mcuEqCurrentConfig: 4614 ← Primary config read command
- connectState: 4353
- agreementConfig: 4384
- upload: 4358

### Direct EQ Band Write (36864-40191 range)
Base: 36864 (0x9000)
With band offset: 36864 | ((bandNum) << 8)
Then OR with sub-command (1-10):
- 1: type
- 2: frequency
- 3: gain
- 4: Q factor
- 5: enabled (L channel)
- 6: type (R channel)
- 7: frequency (R channel)
- 8: gain (R channel)
- 9: Q factor (R channel)
- 10: enabled (R channel)

Example for band 1 (index 0), left type:
`(1 | (36864 | ((0+1)<<8))) = 0x9001`

## Config Data Upload/Download

### Download Sequence (for reading configs from device)
```javascript
async function v(e, i, n) {
  let r = n?.isActive ?? (() => true);
  let o = i.length;  // number of configs to download
  
  for (let n=0; n<o; n++) {
    if (!r()) return;
    await e(downloadSingleConfig, i[n] ?? 0, {
      protocolType: writeNack,
      totalFrameLen: o,
      curFrame: n
    });
    if (n % 10 == 9) await delay(20ms);  // Throttle every 10 frames
  }
  r() && await delay(120ms);
}
```

### Delete Sequence
```javascript
async function w(e, i, n) {
  let r = n?.isActive ?? (() => true);
  if (!r()) return;
  
  await e(deleteConfig, i, {protocolType: writeNack});
  await delay(140ms);
  r() && await requestPeqSnapshot(e);  // Re-read state after delete
}
```

### Rename Sequence
```javascript
async function x(e, i, n, r) {
  let o = r?.isActive ?? (() => true);
  if (o()) {
    await e(renameConfigIndex, i, {protocolType: writeNack});
    await delay(50ms);
    for (let i=0; i<n.length; i++) {
      if (!o()) return;
      await e(renameConfigName, n[i] ?? 0, {
        protocolType: writeNack,
        totalFrameLen: n.length,
        curFrame: i
      });
    }
    o() && await delay(80ms);
  }
}
```

## Reading Preamp/Global Gain

The preamp gain uses a complex lookup table encoding (functions `a` and `n` in file 34c6de754947383b.js):

### Encoding Tables
Two arrays (positive and negative gains):
- Positive (i[]): 163 entries for 0 to +12 dB (in 0.1dB steps)
- Negative (t[]): 163 entries for -12 to 0 dB (in 0.1dB steps)

Each entry is a precomputed 32-bit value representing the encoded gain.

### Encoding Function
```javascript
function a(e) {
  let n = Math.round(10 * Math.abs(e));  // Convert dB to 0.1dB steps
  if (n >= 0) {
    return (i[Math.min(n, i.length-1)] ?? i[0] ?? 0x2000000) >>> 0;
  } else {
    return (t[Math.min(n, t.length-1)] ?? t[0] ?? 0x2000000) >>> 0;
  }
}
```

Lookup indices: 0-120 for ±12 dB range

## Summary of Concrete Values

### Protocol Constants
- Header: 0x22 0x33
- Footer: 0x66 0x77
- Frame size: 16 bytes
- Max totalFrameLen: 16 frames per message
- Data field: 32-bit unsigned little-endian

### Band Parameters
- Bands per channel: 11
- Total bands: 22 (L+R)
- Freq range: 20Hz - 20000Hz (default 632Hz)
- Gain range: -12dB to +12dB (multiplier ×10 for encoding, ÷10 for decoding)
- Q range: 0.1 to 20 (multiplier ×10000 for encoding, ÷10000 for decoding)
- Gain encoding: signed 8-bit (-128 to 127), decoded as n/10 dB
- Q encoding: unsigned 32-bit, 1e4 multiplier
- Freq encoding: unsigned 32-bit direct

### Config Serialization Size
- Per config: 196 bytes minimum
- With padding: 200 bytes
- Response frames: typically 70+ frames per request

