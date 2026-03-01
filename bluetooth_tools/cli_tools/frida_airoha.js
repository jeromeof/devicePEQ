/**
 * Airoha Bluetooth Chipset Protocol Capture
 *
 * Airoha (formerly MediaTek) is a common chipset in TWS earbuds and headphones
 * This script captures and parses Airoha-specific protocols
 *
 * Common Airoha patterns:
 * - Command packets often start with 0x05 0x5A or 0x05 0x5B
 * - Uses proprietary binary protocol
 * - EQ commands typically in the 0x90-0xA0 range
 *
 * Features:
 * - Airoha packet detection and parsing
 * - EQ/ANC command identification
 * - Checksum verification
 * - Battery/status monitoring
 */

// Store original console.log
const originalConsoleLog = console.log;

// Wrapper to send to both console and Python (for file output)
console.log = function(...args) {
    const message = args.join(' ');
    originalConsoleLog.apply(console, args);
    // Send to Python handler for file output
    try {
        send({type: "log", message: message});
    } catch(e) {
        // Ignore if send fails
    }
};

console.log("🔊 Airoha Protocol Capture v1.0");
console.log("NaN"); // Hack to separate initialization from capture

// FILTER_KEEPALIVE will be replaced by Python script
const FILTER_KEEPALIVE = false;

Java.perform(function() {
    console.log("📱 Initializing Airoha-specific hooks...");
    if (FILTER_KEEPALIVE) {
        console.log("🔇 Keepalive filtering: ENABLED");
    }
    console.log("");

    // Known Airoha command IDs
    const AIROHA_COMMANDS = {
        0x01: "Device Info",
        0x02: "Battery Status",
        0x03: "Connect Status",
        0x10: "ANC Control",
        0x11: "Ambient Mode",
        0x20: "EQ Settings",
        0x21: "EQ Enable/Disable",
        0x22: "EQ Preset",
        0x30: "Touch Controls",
        0x40: "Firmware Update",
        0x50: "Audio Settings",
        0x90: "Custom EQ",
        0x91: "PEQ Band 1",
        0x92: "PEQ Band 2",
        0x93: "PEQ Band 3",
        0x94: "PEQ Band 4",
        0x95: "PEQ Band 5",
    };

    // ====================================================================
    // BLUETOOTH HOOKS
    // ====================================================================

    try {
        const OutputStream = Java.use("java.io.OutputStream");

        OutputStream.write.overload('[B').implementation = function(bytes) {
            const arr = Array.prototype.slice.call(bytes);

            // Check for keepalive and filter if enabled
            if (FILTER_KEEPALIVE && isKeepalivePacket(arr)) {
                // Silently skip keepalive packets
                return this.write(bytes);
            }

            // Check for Airoha pattern
            if (isAirohaPacket(arr)) {
                console.log("\n" + "🔊".repeat(40));
                console.log("📤 AIROHA TX (to device)");
                console.log("🔊".repeat(40));
                parseAirohaPacket(arr, "TX");
                console.log("🔊".repeat(40));
            } else {
                // Log non-Airoha packets too
                console.log("\n" + "!".repeat(80));
                console.log("📤 TX (unknown protocol)");
                console.log("Length: " + arr.length);
                console.log("Hex: " + bytesToHex(arr));
                console.log("!".repeat(80));
            }

            return this.write(bytes);
        };

        const InputStream = Java.use("java.io.InputStream");

        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);

            if (result > 0) {
                const arr = Array.prototype.slice.call(buffer, 0, result);

                // Check for keepalive and filter if enabled
                if (FILTER_KEEPALIVE && isKeepalivePacket(arr)) {
                    // Silently skip keepalive packets
                    return result;
                }

                if (isAirohaPacket(arr)) {
                    console.log("\n" + "🔊".repeat(40));
                    console.log("📥 AIROHA RX (from device)");
                    console.log("🔊".repeat(40));
                    parseAirohaPacket(arr, "RX");
                    console.log("🔊".repeat(40));
                } else {
                    console.log("\n" + "!".repeat(80));
                    console.log("📥 RX (unknown protocol)");
                    console.log("Length: " + arr.length);
                    console.log("Hex: " + bytesToHex(arr));
                    console.log("!".repeat(80));
                }
            }

            return result;
        };

        console.log("✅ Bluetooth hooks installed");
    } catch(e) {
        console.log("⚠️  Bluetooth hooks failed: " + e.message);
    }

    // BLE GATT hooks
    try {
        const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");

        BluetoothGatt.writeCharacteristic.overload('android.bluetooth.BluetoothGattCharacteristic').implementation = function(characteristic) {
            const uuid = characteristic.getUuid().toString();
            const value = characteristic.getValue();

            if (value && value.length > 0) {
                const arr = Array.prototype.slice.call(value);

                // Check for keepalive and filter if enabled
                if (FILTER_KEEPALIVE && isKeepalivePacket(arr)) {
                    // Silently skip keepalive packets
                    return this.writeCharacteristic(characteristic);
                }

                if (isAirohaPacket(arr)) {
                    console.log("\n" + "🔊".repeat(40));
                    console.log("📤 AIROHA BLE TX");
                    console.log("UUID: " + uuid);
                    console.log("🔊".repeat(40));
                    parseAirohaPacket(arr, "TX");
                    console.log("🔊".repeat(40));
                }
            }

            return this.writeCharacteristic(characteristic);
        };

        console.log("✅ BLE GATT hooks installed");
    } catch(e) {
        console.log("⚠️  BLE hooks failed: " + e.message);
    }

    // ====================================================================
    // AIROHA PROTOCOL FUNCTIONS
    // ====================================================================

    function isAirohaPacket(bytes) {
        if (bytes.length < 3) return false;

        // Pattern 1: 05 5A ... (common Airoha command)
        if (bytes[0] === 0x05 && bytes[1] === 0x5A) return true;

        // Pattern 2: 05 5B ... (Airoha response)
        if (bytes[0] === 0x05 && bytes[1] === 0x5B) return true;

        // Pattern 3: AA ... (some Airoha variants)
        if (bytes[0] === 0xAA && bytes.length > 5) return true;

        // Pattern 4: Check for Airoha EQ signature (0x90-0x9F command range)
        if (bytes.length >= 4 && bytes[2] >= 0x90 && bytes[2] <= 0x9F) return true;

        return false;
    }

    function isKeepalivePacket(bytes) {
        if (bytes.length < 3) return false;

        // TX preset query pattern: 05 5A 06 00 00 0A XX [counter] (last 3 bytes vary)
        // This polls all presets (0x00-0x03, 0x10-0x13) continuously
        if (bytes.length === 10 &&
            bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x06 &&
            bytes[3] === 0x00 && bytes[4] === 0x00 && bytes[5] === 0x0A) {
            // bytes[6] is preset index, bytes[7-9] are counter/timestamp (varies)
            return true;
        }

        // RX preset response pattern: 05 5B BD 00 00 0A [preset data] (193 bytes)
        // Contains full 10-band PEQ data for queried preset, data varies by preset
        if (bytes.length === 193 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0xBD &&
            bytes[3] === 0x00 && bytes[4] === 0x00 && bytes[5] === 0x0A) {
            return true;
        }

        // RX keepalive pattern: 05 5B 12 00 00 0A 0E 00 ... (common query response)
        if (bytes.length === 22 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x12 &&
            bytes[3] === 0x00 && bytes[4] === 0x00 && bytes[5] === 0x0A) {
            return true;
        }

        // RX keepalive pattern: 05 5B 4A 00 00 0A 46 00 ... (capabilities query)
        if (bytes.length === 78 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x4A &&
            bytes[3] === 0x00 && bytes[4] === 0x00 && bytes[5] === 0x0A) {
            return true;
        }

        // TX/RX device status queries
        if (bytes.length === 8 &&
            bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x04 &&
            bytes[3] === 0x00 && bytes[4] === 0x01 && bytes[5] === 0x09 &&
            bytes[6] === 0x00 && bytes[7] === 0x00) {
            return true;
        }

        // RX device status responses
        if (bytes.length === 10 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x06 &&
            bytes[3] === 0x00 && bytes[4] === 0x01 && bytes[5] === 0x09 &&
            bytes[6] === 0x00 && bytes[7] === 0x00) {
            return true;
        }

        // TX status query: 05 5A 04 00 83 2C [counter] 00 (byte 6 is counter)
        if (bytes.length === 8 &&
            bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x04 &&
            bytes[3] === 0x00 && bytes[4] === 0x83 && bytes[5] === 0x2C &&
            bytes[7] === 0x00) {
            // Ignore bytes[6] - it's a counter that changes
            return true;
        }

        // RX status response: 05 5B 06 00 83 2C 00 [counter] 00 XX (byte 7 is counter)
        if (bytes.length === 10 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x06 &&
            bytes[3] === 0x00 && bytes[4] === 0x83 && bytes[5] === 0x2C &&
            bytes[6] === 0x00 && bytes[8] === 0x00) {
            // Ignore bytes[7] and bytes[9] - they're counters that change
            return true;
        }

        // TX Battery Status: 05 5A 02 00 10 09
        if (bytes.length === 6 &&
            bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x02 &&
            bytes[3] === 0x00 && bytes[4] === 0x10 && bytes[5] === 0x09) {
            return true;
        }

        // RX Battery Status response: 05 5B 0C 00 10 09 00 05 00 FF 00 02 01 07 07 01
        if (bytes.length === 16 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x0C &&
            bytes[3] === 0x00 && bytes[4] === 0x10 && bytes[5] === 0x09) {
            return true;
        }

        // TX status query: 05 5A 04 00 01 09 [counter] 00 (byte 6 is counter)
        if (bytes.length === 8 &&
            bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x04 &&
            bytes[3] === 0x00 && bytes[4] === 0x01 && bytes[5] === 0x09 &&
            bytes[7] === 0x00) {
            // Ignore bytes[6] - it's a counter that changes
            return true;
        }

        // RX status response: 05 5B 06 00 01 09 [counter] 00 00 XX (byte 6 is counter)
        if (bytes.length === 10 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x06 &&
            bytes[3] === 0x00 && bytes[4] === 0x01 && bytes[5] === 0x09 &&
            bytes[7] === 0x00 && bytes[8] === 0x00) {
            // Ignore bytes[6] and bytes[9] - they're counters that change
            return true;
        }

        // Generic connect status (repeating heartbeat)
        if (bytes.length === 7 &&
            bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x03 &&
            bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C) {
            return true;
        }

        if (bytes.length === 7 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x03 &&
            bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C) {
            return true;
        }

        // Unknown protocol keepalive (0x5D)
        if (bytes.length === 9 &&
            bytes[0] === 0x05 && bytes[1] === 0x5D && bytes[2] === 0x05 &&
            bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C) {
            return true;
        }

        // Combined packet: 05 5B 03 00 D6 0C 00 05 5D 05 00 D6 0C 00 00 5F (length 16)
        // This is two packets merged together - connect status + unknown protocol
        if (bytes.length === 16 &&
            bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x03 &&
            bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C &&
            bytes[7] === 0x05 && bytes[8] === 0x5D) {
            return true;
        }

        return false;
    }

    function parseAirohaPacket(bytes, direction) {
        console.log("Length: " + bytes.length);
        console.log("Hex: " + bytesToHex(bytes));

        const header = bytes[0];
        const type = bytes.length > 1 ? bytes[1] : 0;
        const command = bytes.length > 2 ? bytes[2] : 0;

        console.log("\n   ┌─ Airoha Protocol ─┐");
        console.log("   │ Header:  0x" + header.toString(16).toUpperCase());
        console.log("   │ Type:    0x" + type.toString(16).toUpperCase());
        console.log("   │ Command: 0x" + command.toString(16).toUpperCase());

        // Decode command
        const commandName = AIROHA_COMMANDS[command] || "Unknown";
        console.log("   │ Name:    " + commandName);

        // Parse based on command type
        if (command >= 0x20 && command <= 0x22) {
            parseAirohaEQ(bytes);
        } else if (command >= 0x90 && command <= 0x95) {
            parseAirohaPEQ(bytes);
        } else if (command === 0x10 || command === 0x11) {
            parseAirohaANC(bytes);
        } else {
            // Generic payload
            if (bytes.length > 3) {
                const payload = bytes.slice(3);
                console.log("   │ Payload: " + bytesToHex(payload));
            }
        }

        // Check checksum if present
        if (bytes.length > 1) {
            const calculatedChecksum = calculateChecksum(bytes.slice(0, -1));
            const actualChecksum = bytes[bytes.length - 1];

            if (calculatedChecksum === actualChecksum) {
                console.log("   │ Checksum: ✓ Valid (0x" + actualChecksum.toString(16).toUpperCase() + ")");
            } else {
                console.log("   │ Checksum: ? (calc: 0x" + calculatedChecksum.toString(16).toUpperCase() +
                           ", actual: 0x" + actualChecksum.toString(16).toUpperCase() + ")");
            }
        }

        console.log("   └────────────────────┘");
    }

    function parseAirohaEQ(bytes) {
        console.log("   │");
        console.log("   │ 🎵 EQ Settings:");

        if (bytes.length > 3) {
            const mode = bytes[3];
            console.log("   │   Mode: " + mode + " (" + getEQMode(mode) + ")");

            // Try to parse EQ parameters
            if (bytes.length > 4) {
                const preset = bytes[4];
                console.log("   │   Preset: " + preset);
            }
        }
    }

    function parseAirohaPEQ(bytes) {
        console.log("   │");
        console.log("   │ 🎚️  PEQ Band:");

        const bandNum = bytes[2] - 0x90;  // Band 1-5
        console.log("   │   Band: " + bandNum);

        if (bytes.length >= 10) {
            // Common Airoha PEQ format: [freq_h, freq_l, gain_h, gain_l, q_h, q_l]
            const freq = (bytes[3] << 8) | bytes[4];
            const gainRaw = (bytes[5] << 8) | bytes[6];
            const qRaw = (bytes[7] << 8) | bytes[8];

            // Gain is often stored as signed 16-bit, divided by 10
            const gainSigned = gainRaw > 32767 ? gainRaw - 65536 : gainRaw;
            const gainDb = gainSigned / 10.0;

            // Q is often stored as unsigned 16-bit, divided by 100
            const q = qRaw / 100.0;

            console.log("   │   Frequency: " + freq + " Hz");
            console.log("   │   Gain: " + gainDb.toFixed(1) + " dB");
            console.log("   │   Q: " + q.toFixed(2));

            // Filter type
            if (bytes.length > 9) {
                const filterType = bytes[9];
                console.log("   │   Type: " + getFilterType(filterType));
            }
        }
    }

    function parseAirohaANC(bytes) {
        console.log("   │");
        console.log("   │ 🎧 ANC Control:");

        if (bytes.length > 3) {
            const mode = bytes[3];
            console.log("   │   Mode: " + getANCMode(mode));

            if (bytes.length > 4) {
                const level = bytes[4];
                console.log("   │   Level: " + level);
            }
        }
    }

    function getEQMode(mode) {
        const modes = {
            0x00: "Off",
            0x01: "Preset 1",
            0x02: "Preset 2",
            0x03: "Preset 3",
            0x04: "Custom",
            0xFF: "Custom PEQ"
        };
        return modes[mode] || "Unknown";
    }

    function getFilterType(type) {
        const types = {
            0x00: "Peaking",
            0x01: "Low Shelf",
            0x02: "High Shelf",
            0x03: "Low Pass",
            0x04: "High Pass",
            0x05: "Notch"
        };
        return types[type] || "Unknown";
    }

    function getANCMode(mode) {
        const modes = {
            0x00: "Off",
            0x01: "ANC On",
            0x02: "Ambient Mode",
            0x03: "Adaptive"
        };
        return modes[mode] || "Unknown";
    }

    function calculateChecksum(bytes) {
        let sum = 0;
        for (let i = 0; i < bytes.length; i++) {
            sum += bytes[i] & 0xFF;
        }
        return sum & 0xFF;
    }

    function bytesToHex(bytes) {
        return bytes.map(function(b) {
            return ("0" + (b & 0xFF).toString(16).toUpperCase()).slice(-2);
        }).join(" ");
    }

    console.log("\n✅ Airoha-specific hooks active!");
    console.log("📡 Monitoring for Airoha protocol packets...\n");
    console.log("💡 Supported features:");
    console.log("   - EQ presets and custom EQ");
    console.log("   - PEQ bands (frequency, gain, Q, type)");
    console.log("   - ANC/Ambient mode");
    console.log("   - Battery status");
    console.log("   - Touch controls\n");
});
