# Earfun Tune Pro - READ Command Investigation

**Date**: 2026-01-25
**Status**: CONFIRMED - No Read Command Exists
**Source**: Decompiled Android app analysis

---

## 🔍 Finding: Write-Only Protocol

After analyzing the decompiled Android app source code in `~/Downloads/Earfun-Android-source`, I can confirm:

### ❌ NO READ Command for Custom EQ

**Evidence from `EarfunProtocolParser.java`:**

```java
// Line 74: SET command EXISTS
private byte[] SET_EQ = {32, -107};  // 0x20, 0x95 ✅

// Lines 842-844: Write method EXISTS
public byte[] buildEqCommond(byte[] bArr) {
    Intrinsics.checkNotNullParameter(bArr, "playload");
    return buildEarfunCommond(this.SET_EQ, bArr);
}

// ❌ NO GET_EQ declaration found
// ❌ NO getEQ() or getCustomEQ() method found
```

**Comparison with other commands:**
The parser has MANY other GET commands:
- `getVersion()` - reads firmware version
- `getColor()` - reads LED color
- `getMicSet()` - reads mic settings
- `getBatteryCommond()` - reads battery level
- `getAllInfo()` - reads device info
- `getKeyCustomNoise()` - reads key mappings

**But NO equivalent for Custom EQ!**

---

## 📱 How the Android App Works

Since the device doesn't support reading EQ, the app uses **local storage**:

### 1. **First Time / Reset**
- App shows default flat EQ (0dB all bands)
- User edits values
- App saves to `SharedPreferences` on phone
- App sends WRITE commands to device

### 2. **Subsequent Opens**
- App reads from `SharedPreferences`
- Displays last-saved values
- User can edit and re-save

### 3. **Device Doesn't Remember**
The device likely has volatile memory for EQ:
- Changes are applied when WRITE commands are received
- But NOT saved to non-volatile memory
- **OR** saved internally but with no way to query them

---

## 💻 Web Interface Solution

This is why the web interface shows: `"Device does not support reading EQ (write-only protocol)"`

### Current Implementation

```javascript
async function earfunGetPEQ() {
    logEarfun('📥 Device does not support reading EQ (write-only protocol)', 'info');
    logEarfun('💡 Displaying default flat EQ. Edit and click "Write All Bands" to save.', 'info');

    // Initialize with flat EQ since we can't read from device
    initEarfunPEQ();
    displayEarfunPEQ();
}
```

### Workaround Features

1. **Local State Management**
   - `earfunPEQData` array stores current editor state
   - Persists during browser session
   - User can edit freely

2. **Explicit Write Button**
   - "Write All Bands" sends all 10 bands at once
   - 50ms delay between commands
   - Console logs each command for debugging

3. **Browser localStorage (Future Enhancement)**
   - Could save EQ profiles locally
   - Auto-restore last-used EQ on page load
   - Similar to how Android app works

---

## 🧪 Testing: Frida Capture During Connection

To be absolutely certain, let's capture what happens when the app first connects:

### Run Frida Capture

```bash
cd /Users/jeromeof/Development/PragmagicAudio/DevicePEQ/bluetooth_tools/cli_tools

# Start Frida with connection monitor
frida -U -f com.corelink.earfun -l frida_earfun_connect.js --no-pause
```

### What to Do in App

1. **Kill and restart the Earfun app**
2. **Connect to Tune Pro headphones**
3. **Go to EQ settings page**
4. **Watch Frida output for**:
   - Any commands with opcode != `0x95` (write)
   - Possible opcode `0x94` or `0x96` (neighboring values)
   - SharedPreferences reads/writes

### What to Look For

If a READ command exists, we'd see:
```
[12:34:56] 📤 TX (POSSIBLE EQ READ): EF 20 94 00 ... FE
                                              ^^ different opcode
[12:34:56] 📥 RX: EF 20 94 XX [EQ DATA...] FE
```

If EQ is stored locally:
```
[*] 💾 SharedPreferences READ: custom_eq_band_1 = 3.0
[*] 💾 SharedPreferences READ: custom_eq_band_2 = -2.0
```

---

## 🎯 Likely Scenarios

Based on analysis, here's what probably happens:

### Scenario 1: Volatile Memory (Most Likely)
```
User edits EQ in app → Sends WRITE commands → Device applies changes
Power cycle → EQ resets to default → User must re-apply from app
```

### Scenario 2: Non-Volatile Memory, No Query
```
User edits EQ in app → Sends WRITE commands → Device saves to flash
Power cycle → EQ persists → But no way to READ current state
```

**Why this matters:** If Scenario 2, your web tool's WRITE commands WILL persist across power cycles!

---

## ✅ Testing Steps

### Test Persistence

1. **In Web Tool:**
   - Set Band 1 to 31.5Hz, +6dB
   - Click "Write All Bands"
   - Listen to music (should hear bass boost)

2. **Power Cycle:**
   - Turn headphones off
   - Wait 10 seconds
   - Turn headphones on

3. **Listen Again:**
   - Play same music
   - Does bass boost persist?

**If YES:** EQ is saved, but can't be read
**If NO:** EQ is volatile, needs re-sending

---

## 🔧 Future Enhancements

### 1. Browser localStorage

```javascript
// Save EQ to browser
function saveEarfunEQ(name) {
    const profiles = JSON.parse(localStorage.getItem('earfun_eq_profiles') || '{}');
    profiles[name] = earfunPEQData;
    localStorage.setItem('earfun_eq_profiles', JSON.stringify(profiles));
}

// Load EQ from browser
function loadEarfunEQ(name) {
    const profiles = JSON.parse(localStorage.getItem('earfun_eq_profiles') || '{}');
    if (profiles[name]) {
        earfunPEQData = profiles[name];
        displayEarfunPEQ();
    }
}

// Auto-restore last used
window.addEventListener('load', () => {
    const lastEQ = localStorage.getItem('earfun_last_eq');
    if (lastEQ) {
        earfunPEQData = JSON.parse(lastEQ);
        displayEarfunPEQ();
    }
});
```

### 2. EQ Profile Presets

```javascript
const EQ_PRESETS = {
    'Bass Boost': [
        {frequency: 31.5, gain: 6, q: 2867, enabled: true},
        {frequency: 63, gain: 6, q: 2867, enabled: true},
        {frequency: 125, gain: 3, q: 2867, enabled: true},
        // ... rest at 0dB
    ],
    'Treble Boost': [
        // ... high frequencies boosted
    ],
    'V-Shape': [
        // ... bass and treble up, mids down
    ]
};
```

### 3. Import/Export

```javascript
// Export to file
function exportEarfunEQ() {
    const json = JSON.stringify(earfunPEQData, null, 2);
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'earfun_eq.json';
    a.click();
}

// Import from file
function importEarfunEQ(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        earfunPEQData = JSON.parse(e.target.result);
        displayEarfunPEQ();
    };
    reader.readAsText(file);
}
```

---

## 📝 Conclusion

1. **Decompiled source confirms**: NO READ command for custom EQ
2. **Web interface is correct**: Shows "write-only protocol" message
3. **Workaround works**: Maintain state locally, explicit writes
4. **Next test**: Capture connection with Frida to be 100% sure
5. **Persistence test**: Check if EQ survives power cycle

---

## 🎬 Quick Start

### Use Web Interface NOW

```bash
open ../webtools/bluetooth_device_tester.html
```

1. Click **🎵 Earfun (Tune Pro)** tab
2. Click **"Connect Device"**
3. Click **"Read Current EQ"** (initializes with flat EQ)
4. Edit frequency, gain, Q values in table
5. Click **"Write All Bands"** to send to device
6. Test audio immediately

### Verify with Frida

```bash
frida -U -f com.corelink.earfun -l frida_earfun_connect.js --no-pause
```

Then connect in the app and watch for any READ commands.

---

**Last Updated**: 2026-01-25
**Files**:
- Source analysis: `~/Downloads/Earfun-Android-source/sources/com/corelink/earfun/device/protocol/headset/EarfunProtocolParser.java`
- Frida script: `frida_earfun_connect.js`
- Web interface: `../webtools/bluetooth_device_tester.html`
