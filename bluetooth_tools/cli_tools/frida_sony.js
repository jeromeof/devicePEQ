/**
 * Frida Script for Sony Headphones Bluetooth Capture
 *
 * Captures Sony BLE protocol communication for WH-1000XM5, WH-1000XM6, etc.
 * Hooks Sony SoundConnect app BLE GATT operations
 *
 * Usage:
 *   frida -U -f com.sony.songpal.tandemfamily -l frida_sony.js --no-pause
 *   frida -U "Sony | Headphones Connect" -l frida_sony.js
 *
 * Protocol: Sony "Tandem" BLE GATT
 * Service UUID: 45C93E07-D90D-4B93-A9DB-91E5DD734E35
 */

console.log("\n" + "=".repeat(80));
console.log("🎧 Sony Headphones BLE Protocol Capture");
console.log("=".repeat(80));
console.log("Target: Sony SoundConnect / Headphones Connect");
console.log("Devices: WH-1000XM5, WH-1000XM6, WF-1000XM5, LinkBuds");
console.log("=".repeat(80) + "\n");

// Sony Protocol Constants
const SONY_SERVICE_UUID = "45c93e07-d90d-4b93-a9db-91e5dd734e35";
const WRITE_CHAR_UUID = "45c93c15-d90d-4b93-a9db-91e5dd734e35";
const NOTIFY_CHAR_UUID = "45c93c16-d90d-4b93-a9db-91e5dd734e35";

// Command names for decoding
const COMMAND_NAMES = {
    // EQ Commands
    0x50: "EQEBB_GET_CAPABILITY",
    0x51: "EQEBB_RET_CAPABILITY",
    0x52: "EQEBB_GET_STATUS",
    0x53: "EQEBB_RET_STATUS",
    0x55: "EQEBB_NTFY_STATUS",
    0x56: "EQEBB_GET_PARAM",
    0x57: "EQEBB_RET_PARAM",
    0x58: "EQEBB_SET_PARAM",
    0x59: "EQEBB_NTFY_PARAM",
    0x5A: "EQEBB_GET_EXTENDED_INFO",
    0x5B: "EQEBB_RET_EXTENDED_INFO",

    // Common Commands
    0x00: "CONNECT_GET_PROTOCOL_INFO",
    0x01: "CONNECT_RET_PROTOCOL_INFO",
    0x10: "COMMON_GET_BATTERY_LEVEL",
    0x11: "COMMON_RET_BATTERY_LEVEL",
    0x18: "COMMON_GET_AUDIO_CODEC",
    0x19: "COMMON_RET_AUDIO_CODEC",

    // Noise Canceling
    0x60: "NCASM_GET_CAPABILITY",
    0x62: "NCASM_GET_STATUS",
    0x68: "NCASM_SET_PARAM",

    // Update Commands
    0x12: "UPDT_SET_COMMAND",
    0x13: "UPDT_RET_COMMAND",
    0x14: "UPDT_GET_STATUS",
    0x15: "UPDT_RET_STATUS",
    0x16: "UPDT_NTFY_STATUS",
};

// EQ Preset names
const EQ_PRESETS = {
    0x00: "Off",
    0x01: "Rock",
    0x02: "Pop",
    0x03: "Jazz",
    0x04: "Dance",
    0x05: "EDM",
    0x06: "R&B/Hip-Hop",
    0x07: "Acoustic",
    0x10: "Bright",
    0x11: "Excited",
    0x12: "Mellow",
    0x13: "Relaxed",
    0x14: "Vocal",
    0x15: "Treble",
    0x16: "Bass",
    0x17: "Speech",
    0xA0: "Custom",
    0xA1: "User Setting 1",
    0xA2: "User Setting 2",
    0xA3: "User Setting 3",
    0xA4: "User Setting 4",
    0xA5: "User Setting 5",
};

// Typical Sony EQ band frequencies (fixed, not configurable)
const TYPICAL_FREQUENCIES = [400, 1000, 2500, 6300, 16000];

function bytesToHex(bytes) {
    if (!bytes) return "";
    if (bytes instanceof ArrayBuffer) {
        bytes = new Uint8Array(bytes);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function parseEQCommand(data, direction) {
    if (data.length < 1) return "";

    const cmd = data[0];
    let info = "";

    // Parse based on command
    if (cmd === 0x58) {  // EQEBB_SET_PARAM
        if (data.length >= 4) {
            const inquiryType = data[1];
            const presetId = data[2];
            const numBands = data[3];

            info += `\n   Inquiry Type: 0x${inquiryType.toString(16).padStart(2, '0')}`;
            info += `\n   Preset: ${EQ_PRESETS[presetId] || 'Unknown'} (0x${presetId.toString(16).padStart(2, '0')})`;
            info += `\n   Bands: ${numBands}`;

            if (numBands > 0 && data.length >= 4 + numBands) {
                info += "\n   Values: [";
                for (let i = 0; i < numBands; i++) {
                    let val = data[4 + i];
                    // Convert to signed
                    if (val > 127) val = val - 256;

                    if (i < TYPICAL_FREQUENCIES.length) {
                        const freq = TYPICAL_FREQUENCIES[i];
                        const freqStr = freq >= 1000 ? `${freq/1000}kHz` : `${freq}Hz`;
                        info += `\n     ${freqStr}: ${val >= 0 ? '+' : ''}${val}dB`;
                    } else {
                        info += `\n     Band ${i+1}: ${val >= 0 ? '+' : ''}${val}dB`;
                    }
                }
                info += "\n   ]";
            }
        }
    } else if (cmd === 0x53) {  // EQEBB_RET_STATUS
        if (data.length >= 4) {
            const presetId = data[2];
            const numBands = data[3];

            info += `\n   Preset: ${EQ_PRESETS[presetId] || 'Unknown'} (0x${presetId.toString(16).padStart(2, '0')})`;
            info += `\n   Bands: ${numBands}`;

            if (numBands > 0 && data.length >= 4 + numBands) {
                info += "\n   Current EQ: [";
                for (let i = 0; i < numBands; i++) {
                    let val = data[4 + i];
                    if (val > 127) val = val - 256;

                    if (i < TYPICAL_FREQUENCIES.length) {
                        const freq = TYPICAL_FREQUENCIES[i];
                        const freqStr = freq >= 1000 ? `${freq/1000}kHz` : `${freq}Hz`;
                        info += `\n     ${freqStr}: ${val >= 0 ? '+' : ''}${val}dB`;
                    } else {
                        info += `\n     Band ${i+1}: ${val >= 0 ? '+' : ''}${val}dB`;
                    }
                }
                info += "\n   ]";
            }
        }
    } else if (cmd === 0x51) {  // EQEBB_RET_CAPABILITY
        if (data.length >= 5) {
            let minGain = data[2];
            let maxGain = data[3];
            if (minGain > 127) minGain = minGain - 256;
            if (maxGain > 127) maxGain = maxGain - 256;

            info += `\n   Gain Range: ${minGain} to ${maxGain} dB`;
            info += `\n   Num Presets: ${data[4]}`;
        }
    } else if (cmd === 0x11) {  // COMMON_RET_BATTERY_LEVEL
        if (data.length >= 2) {
            info += `\n   Battery: ${data[1]}%`;
        }
    } else if (cmd === 0x52) {  // EQEBB_GET_STATUS
        info += `\n   Query Type: 0x${data[1].toString(16).padStart(2, '0')}`;
    }

    return info;
}

function logSonyPacket(data, direction, context) {
    if (data.length === 0) return;

    const cmd = data[0];
    const cmdName = COMMAND_NAMES[cmd] || `UNKNOWN_0x${cmd.toString(16).padStart(2, '0')}`;
    const arrow = direction === "TX" ? "📤" : "📥";
    const dirLabel = direction === "TX" ? "SONY TX" : "SONY RX";

    console.log(`\n${arrow} ${dirLabel} (${context})`);
    console.log(`   Command: ${cmdName} (0x${cmd.toString(16).padStart(2, '0')})`);
    console.log(`   Length: ${data.length} bytes`);
    console.log(`   Hex: ${bytesToHex(data)}`);

    // Parse specific commands
    const parsed = parseEQCommand(data, direction);
    if (parsed) {
        console.log(parsed);
    }
}

// Hook Android BluetoothGatt writeCharacteristic
try {
    const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");

    BluetoothGatt.writeCharacteristic.overload('android.bluetooth.BluetoothGattCharacteristic').implementation = function(characteristic) {
        const uuid = characteristic.getUuid().toString().toLowerCase();

        if (uuid === WRITE_CHAR_UUID || uuid.includes("45c93c15")) {
            const value = characteristic.getValue();
            if (value && value.length > 0) {
                const data = Array.from(value);
                logSonyPacket(data, "TX", "writeCharacteristic");
            }
        }

        return this.writeCharacteristic(characteristic);
    };

    console.log("✅ Hooked BluetoothGatt.writeCharacteristic");
} catch (e) {
    console.log("⚠️  Could not hook BluetoothGatt.writeCharacteristic:", e.message);
}

// Hook characteristic value changes (notifications)
try {
    const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");

    BluetoothGatt.onCharacteristicChanged.implementation = function(characteristic) {
        const uuid = characteristic.getUuid().toString().toLowerCase();

        if (uuid === NOTIFY_CHAR_UUID || uuid.includes("45c93c16")) {
            const value = characteristic.getValue();
            if (value && value.length > 0) {
                const data = Array.from(value);
                logSonyPacket(data, "RX", "onCharacteristicChanged");
            }
        }

        return this.onCharacteristicChanged(characteristic);
    };

    console.log("✅ Hooked BluetoothGatt.onCharacteristicChanged");
} catch (e) {
    console.log("⚠️  Could not hook onCharacteristicChanged:", e.message);
}

// Also hook readCharacteristic for completeness
try {
    const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");

    BluetoothGatt.readCharacteristic.overload('android.bluetooth.BluetoothGattCharacteristic').implementation = function(characteristic) {
        const result = this.readCharacteristic(characteristic);
        const uuid = characteristic.getUuid().toString().toLowerCase();

        if (uuid === WRITE_CHAR_UUID || uuid === NOTIFY_CHAR_UUID ||
            uuid.includes("45c93c15") || uuid.includes("45c93c16")) {
            console.log(`\n🔍 SONY READ: ${uuid}`);
        }

        return result;
    };

    console.log("✅ Hooked BluetoothGatt.readCharacteristic");
} catch (e) {
    console.log("⚠️  Could not hook readCharacteristic:", e.message);
}

// Hook for service discovery (informational)
try {
    const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");

    BluetoothGatt.discoverServices.implementation = function() {
        console.log("\n🔍 Starting BLE service discovery...");
        const result = this.discoverServices();
        return result;
    };

    BluetoothGatt.onServicesDiscovered.implementation = function(gatt, status) {
        console.log(`\n📡 Services discovered (status: ${status})`);

        try {
            const services = gatt.getServices();
            const iter = services.iterator();
            while (iter.hasNext()) {
                const service = iter.next();
                const svcUuid = service.getUuid().toString().toLowerCase();

                if (svcUuid === SONY_SERVICE_UUID || svcUuid.includes("45c93e07")) {
                    console.log(`\n✨ Found Sony Service: ${svcUuid}`);

                    const chars = service.getCharacteristics();
                    const charIter = chars.iterator();
                    while (charIter.hasNext()) {
                        const char = charIter.next();
                        const charUuid = char.getUuid().toString().toLowerCase();
                        console.log(`   Characteristic: ${charUuid}`);
                    }
                }
            }
        } catch (e) {
            console.log("Error listing services:", e.message);
        }

        return this.onServicesDiscovered(gatt, status);
    };

    console.log("✅ Hooked service discovery");
} catch (e) {
    console.log("⚠️  Could not hook service discovery:", e.message);
}

console.log("\n" + "=".repeat(80));
console.log("📱 Ready to capture Sony Headphones protocol");
console.log("🎯 Interact with the app to see BLE traffic");
console.log("=".repeat(80) + "\n");
