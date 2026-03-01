/**
 * Sony WH-1000XM5 Classic Bluetooth (SPP) Protocol Capture
 *
 * Captures Sony protocol over Classic Bluetooth Serial Port Profile
 * NOT BLE GATT - Sony uses BR/EDR SPP for control!
 */

console.log("\n" + "=".repeat(80));
console.log("🎧 Sony Headphones SPP Protocol Capture");
console.log("=".repeat(80));
console.log("Target: Sony Sound Connect (com.sony.songpal.mdr)");
console.log("Protocol: Classic Bluetooth SPP (BR/EDR)");
console.log("Devices: WH-1000XM5, WH-1000XM6, WF-1000XM5");
console.log("=".repeat(80) + "\n");

// Sony Protocol Constants
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
};

const EQ_PRESETS = {
    0x00: "Off",
    0x10: "Treble Boost",
    0x11: "Bass Boost",
    0x12: "Relaxed",
    0x13: "Mellow",
    0x14: "Vocal",
    0x15: "Bright",
    0x16: "Clear Bass",
    0x17: "Speech",
    0xA0: "Manual",
    0xA1: "Excited",
    0xA2: "Custom 1",
};

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function parseSonyPacket(data, direction) {
    if (data.length < 8) return "";

    // Check for Sony protocol wrapper: 3E 0C ... 3C
    if (data[0] !== 0x3E) return "";

    let info = "";
    const packetType = data[1];

    if (packetType === 0x0C) {
        // Command/Data packet
        const seqFlags = data.slice(2, 6);
        const length = data[6];
        const command = data[7];
        const cmdName = COMMAND_NAMES[command] || `UNKNOWN_0x${command.toString(16).padStart(2, '0')}`;

        info += `\n   Packet Type: 0x0C (Command/Data)`;
        info += `\n   Seq Flags: ${bytesToHex(seqFlags)}`;
        info += `\n   Length: ${length}`;
        info += `\n   Command: ${cmdName} (0x${command.toString(16).padStart(2, '0')})`;

        // Parse EQ commands
        if (command === 0x58 && data.length >= 11) {  // EQEBB_SET_PARAM
            const presetId = data[9];
            const presetName = EQ_PRESETS[presetId] || `Unknown (0x${presetId.toString(16)})`;
            info += `\n   >>> Setting EQ Preset: ${presetName}`;
        } else if (command === 0x59 && data.length >= 11) {  // EQEBB_NTFY_PARAM
            const presetId = data[9];
            const numBands = data[10];
            const presetName = EQ_PRESETS[presetId] || `Unknown (0x${presetId.toString(16)})`;
            info += `\n   >>> EQ Status: ${presetName}`;
            info += `\n   >>> Bands: ${numBands}`;
            if (data.length >= 11 + numBands) {
                const bandValues = data.slice(11, 11 + numBands);
                info += `\n   >>> Band Values: ${bytesToHex(bandValues)}`;
                info += `\n   >>> Gains (dB): [${Array.from(bandValues).map(v => {
                    let val = v - 10;  // 10 = 0dB baseline
                    return (val >= 0 ? '+' : '') + val;
                }).join(', ')}]`;
            }
        } else if (command === 0x53 && data.length >= 11) {  // EQEBB_RET_STATUS
            const presetId = data[9];
            const numBands = data[10];
            const presetName = EQ_PRESETS[presetId] || `Unknown (0x${presetId.toString(16)})`;
            info += `\n   >>> Current EQ: ${presetName}`;
            info += `\n   >>> Bands: ${numBands}`;
        }
    } else if (packetType === 0x01) {
        // ACK packet
        info += `\n   Packet Type: 0x01 (ACK)`;
    }

    return info;
}

function logPacket(direction, data, context) {
    const arrow = direction === "SPP TX" ? "📤" : "📥";
    const hex = bytesToHex(data);

    console.log(`\n${arrow} ${direction} (${context})`);
    console.log(`   Length: ${data.length} bytes`);
    console.log(`   Hex: ${hex}`);

    const parsed = parseSonyPacket(data, direction);
    if (parsed) {
        console.log(parsed);
    }
}

Java.perform(function() {
    console.log("📱 Hooking Classic Bluetooth (SPP) I/O streams...\n");

    // Hook OutputStream for TX (app → device)
    try {
        const OutputStream = Java.use("java.io.OutputStream");

        OutputStream.write.overload('[B').implementation = function(bytes) {
            if (bytes && bytes.length > 0) {
                const data = Array.from(bytes);
                // Only log Sony protocol packets (start with 0x3E)
                if (data[0] === 0x3E) {
                    logPacket("SPP TX", data, "OutputStream.write");
                }
            }
            return this.write(bytes);
        };

        OutputStream.write.overload('[B', 'int', 'int').implementation = function(bytes, offset, length) {
            if (bytes && length > 0) {
                const data = Array.prototype.slice.call(bytes, offset, offset + length);
                if (data[0] === 0x3E) {
                    logPacket("SPP TX", data, "OutputStream.write(offset)");
                }
            }
            return this.write(bytes, offset, length);
        };

        console.log("✅ Hooked OutputStream (TX)");
    } catch(e) {
        console.log("⚠️  OutputStream hook failed: " + e.message);
    }

    // Hook InputStream for RX (device → app)
    try {
        const InputStream = Java.use("java.io.InputStream");

        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, 0, result);
                if (data[0] === 0x3E) {
                    logPacket("SPP RX", data, "InputStream.read");
                }
            }
            return result;
        };

        InputStream.read.overload('[B', 'int', 'int').implementation = function(buffer, offset, length) {
            const result = this.read(buffer, offset, length);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, offset, offset + result);
                if (data[0] === 0x3E) {
                    logPacket("SPP RX", data, "InputStream.read(offset)");
                }
            }
            return result;
        };

        console.log("✅ Hooked InputStream (RX)");
    } catch(e) {
        console.log("⚠️  InputStream hook failed: " + e.message);
    }

    console.log("\n" + "=".repeat(80));
    console.log("📱 Ready to capture Sony SPP protocol");
    console.log("🎯 Change EQ settings in the app to see traffic");
    console.log("=".repeat(80) + "\n");
});
