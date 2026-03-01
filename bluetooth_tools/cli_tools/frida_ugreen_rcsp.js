/**
 * RCSP (Remote Control Serial Protocol) Capture for Ugreen Max5C
 *
 * Captures and parses JieLi RCSP protocol used by Ugreen Max5C headphones
 *
 * Features:
 * - RCSP packet detection (FE DC BA prefix, EF end flag)
 * - EQ data parsing (both static and dynamic formats)
 * - Bass/Treble capture
 * - Command identification (GET/SET_SYS_INFO)
 * - Automatic attribute parsing
 */

console.log("🎧 RCSP Protocol Capture v1.0 (Ugreen Max5C)");
console.log("=".repeat(80));

// RCSP Protocol Constants
const RCSP_START = [0xFE, 0xDC, 0xBA];
const RCSP_END = 0xEF;

const CMD_GET_SYS_INFO = 0x07;
const CMD_SET_SYS_INFO = 0x08;

const ATTR_EQ = 0x04;
const ATTR_BASS_TREBLE = 0x0B;
const ATTR_EQ_PRESET = 0x0C;

const EQ_FREQUENCIES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const packetBuffer = [];

Java.perform(function() {
    console.log("📱 Initializing RCSP hooks...\n");

    // ====================================================================
    // BLE GATT HOOKS
    // ====================================================================

    try {
        const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");
        const BluetoothGattCharacteristic = Java.use("android.bluetooth.BluetoothGattCharacteristic");

        // Hook writeCharacteristic (TX to device)
        BluetoothGatt.writeCharacteristic.overload('android.bluetooth.BluetoothGattCharacteristic').implementation = function(characteristic) {
            const uuid = characteristic.getUuid().toString();

            try {
                const value = characteristic.getValue();
                if (value && value.length > 0) {
                    const bytes = Array.prototype.slice.call(value);

                    // Add to buffer
                    packetBuffer.push(...bytes);

                    // Try to parse complete packet
                    parseRCSPPacket(packetBuffer, "TX", uuid);
                }
            } catch(e) {
                console.log("⚠️  Could not read characteristic value: " + e.message);
            }

            return this.writeCharacteristic(characteristic);
        };

        // Hook onCharacteristicChanged (RX notifications from device)
        const BluetoothGattCallback = Java.use("android.bluetooth.BluetoothGattCallback");

        BluetoothGattCallback.onCharacteristicChanged.overload('android.bluetooth.BluetoothGatt', 'android.bluetooth.BluetoothGattCharacteristic').implementation = function(gatt, characteristic) {
            const uuid = characteristic.getUuid().toString();

            try {
                const value = characteristic.getValue();
                if (value && value.length > 0) {
                    const bytes = Array.prototype.slice.call(value);

                    // Add to buffer
                    packetBuffer.push(...bytes);

                    // Try to parse complete packet
                    parseRCSPPacket(packetBuffer, "RX", uuid);
                }
            } catch(e) {
                console.log("⚠️  Notification error: " + e.message);
            }

            return this.onCharacteristicChanged(gatt, characteristic);
        };

        console.log("✅ BLE GATT hooks installed");
    } catch(e) {
        console.log("⚠️  BLE hooks failed: " + e.message);
    }

    // ====================================================================
    // CLASSIC BLUETOOTH (SPP) HOOKS
    // ====================================================================

    try {
        const OutputStream = Java.use("java.io.OutputStream");

        OutputStream.write.overload('[B').implementation = function(bytes) {
            const data = Array.prototype.slice.call(bytes);
            packetBuffer.push(...data);
            parseRCSPPacket(packetBuffer, "TX (SPP)", "OutputStream");
            return this.write(bytes);
        };

        OutputStream.write.overload('[B', 'int', 'int').implementation = function(bytes, offset, length) {
            const data = Array.prototype.slice.call(bytes, offset, offset + length);
            packetBuffer.push(...data);
            parseRCSPPacket(packetBuffer, "TX (SPP)", "OutputStream");
            return this.write(bytes, offset, length);
        };

        const InputStream = Java.use("java.io.InputStream");

        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, 0, result);
                packetBuffer.push(...data);
                parseRCSPPacket(packetBuffer, "RX (SPP)", "InputStream");
            }
            return result;
        };

        InputStream.read.overload('[B', 'int', 'int').implementation = function(buffer, offset, length) {
            const result = this.read(buffer, offset, length);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, offset, offset + result);
                packetBuffer.push(...data);
                parseRCSPPacket(packetBuffer, "RX (SPP)", "InputStream");
            }
            return result;
        };

        console.log("✅ Classic Bluetooth (SPP) hooks installed");
    } catch(e) {
        console.log("⚠️  SPP hooks failed: " + e.message);
    }
});

// ====================================================================
// RCSP PACKET PARSING
// ====================================================================

function parseRCSPPacket(buffer, direction, source) {
    // Look for start sequence
    let startIdx = -1;
    for (let i = 0; i < buffer.length - 2; i++) {
        if (buffer[i] === RCSP_START[0] &&
            buffer[i+1] === RCSP_START[1] &&
            buffer[i+2] === RCSP_START[2]) {
            startIdx = i;
            break;
        }
    }

    if (startIdx === -1) {
        // No start sequence found, clear old data if buffer too large
        if (buffer.length > 100) {
            buffer.length = 0;
        }
        return;
    }

    // Remove data before start sequence
    if (startIdx > 0) {
        buffer.splice(0, startIdx);
        startIdx = 0;
    }

    // Look for end flag
    let endIdx = -1;
    for (let i = startIdx + 3; i < buffer.length; i++) {
        if (buffer[i] === RCSP_END) {
            endIdx = i;
            break;
        }
    }

    if (endIdx === -1) {
        // Incomplete packet, wait for more data
        return;
    }

    // Extract complete packet
    const packet = buffer.splice(0, endIdx + 1);

    // Parse packet
    console.log("\n" + "=".repeat(80));
    console.log(`📡 RCSP ${direction} | ${source}`);
    console.log("=".repeat(80));
    console.log("Raw: " + bytesToHex(packet));
    console.log("Len: " + packet.length + " bytes");

    if (packet.length < 9) {
        console.log("⚠️  Packet too short");
        console.log("=".repeat(80));
        return;
    }

    try {
        // Parse header
        const flags = packet[3];
        const isCommand = (flags & 0x80) !== 0;
        const hasResponse = (flags & 0x40) !== 0;
        const opCode = packet[4];
        const paramLen = (packet[5] << 8) | packet[6];

        console.log(`\nType: ${isCommand ? 'COMMAND' : 'RESPONSE'}`);
        console.log(`OpCode: 0x${opCode.toString(16).toUpperCase().padStart(2, '0')} (${getOpCodeName(opCode)})`);
        console.log(`HasResponse: ${hasResponse}`);
        console.log(`ParamLen: ${paramLen}`);

        const headerLen = isCommand ? 7 : 8;
        const paramData = packet.slice(headerLen, headerLen + paramLen);

        if (!isCommand && packet.length > 7) {
            const status = packet[7];
            console.log(`Status: ${status === 0 ? '✅ SUCCESS' : '❌ ERROR ' + status}`);
        }

        // Parse parameters
        if (paramData.length > 0) {
            console.log(`\n📦 Parameters:`);

            if (isCommand && (opCode === CMD_GET_SYS_INFO || opCode === CMD_SET_SYS_INFO)) {
                parseCommandParams(paramData, opCode);
            } else if (!isCommand && opCode === CMD_GET_SYS_INFO) {
                parseResponseParams(paramData);
            }
        }

    } catch(e) {
        console.log(`⚠️  Parse error: ${e.message}`);
    }

    console.log("=".repeat(80));
}

function parseCommandParams(data, opCode) {
    if (data.length < 2) return;

    const seq = data[0];
    const func = data[1];

    console.log(`  Sequence: ${seq}`);
    console.log(`  Function: 0x${func.toString(16).toUpperCase().padStart(2, '0')} ${func === 0xFF ? '(Public)' : ''}`);

    if (opCode === CMD_GET_SYS_INFO && data.length >= 6) {
        const mask = (data[2] << 24) | (data[3] << 16) | (data[4] << 8) | data[5];
        console.log(`  Mask: 0x${mask.toString(16).toUpperCase().padStart(8, '0')}`);

        const attrs = [];
        if (mask & 0x10) attrs.push("EQ");
        if (mask & 0x1000) attrs.push("EQ_PRESET");
        if (mask & 0x800) attrs.push("BASS_TREBLE");
        if (attrs.length > 0) {
            console.log(`  Attributes: ${attrs.join(", ")}`);
        }
    } else if (opCode === CMD_SET_SYS_INFO && data.length >= 3) {
        const attrLen = data[2];
        const attrType = data[3];
        const attrData = data.slice(4, 4 + attrLen - 1);

        console.log(`  Attr Length: ${attrLen}`);
        console.log(`  Attr Type: 0x${attrType.toString(16).toUpperCase().padStart(2, '0')} (${getAttrTypeName(attrType)})`);

        parseAttribute(attrType, attrData);
    }
}

function parseResponseParams(data) {
    if (data.length < 3) return;

    const seq = data[0];
    console.log(`  Sequence: ${seq}`);

    let idx = 1;
    while (idx < data.length - 1) {
        const attrLen = data[idx];
        const attrType = data[idx + 1];

        if (idx + attrLen >= data.length) break;

        const attrData = data.slice(idx + 2, idx + attrLen + 1);

        console.log(`\n  📝 Attribute Type: 0x${attrType.toString(16).toUpperCase().padStart(2, '0')} (${getAttrTypeName(attrType)})`);
        console.log(`     Length: ${attrLen}`);

        parseAttribute(attrType, attrData);

        idx += attrLen + 1;
    }
}

function parseAttribute(type, data) {
    if (data.length === 0) return;

    if (type === ATTR_EQ) {
        // EQ Data
        const mode = data[0];
        const isDynamic = (mode & 0x80) !== 0;
        const actualMode = mode & 0x7F;

        console.log(`     Format: ${isDynamic ? 'DYNAMIC' : 'STATIC'}`);
        console.log(`     Mode: ${actualMode}`);

        if (isDynamic && data.length >= 2) {
            const count = data[1];
            const values = data.slice(2, 2 + count);

            console.log(`     Bands: ${count}`);
            console.log(`     Gains: [${values.map(v => signedByte(v)).join(", ")}] dB`);

        } else if (!isDynamic && data.length >= 11) {
            const values = data.slice(1, 11);

            console.log(`     Bands: 10 (fixed)`);
            console.log(`     \n     EQ Settings:`);
            for (let i = 0; i < values.length; i++) {
                const gain = signedByte(values[i]);
                const freq = EQ_FREQUENCIES[i] || '?';
                console.log(`       ${String(freq).padStart(5)}Hz: ${gain >= 0 ? '+' : ''}${gain} dB`);
            }
        }

    } else if (type === ATTR_BASS_TREBLE) {
        // Bass and Treble
        if (data.length >= 8) {
            const bass = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
            const treble = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];

            console.log(`     Bass: ${bass}`);
            console.log(`     Treble: ${treble}`);
        }

    } else if (type === ATTR_EQ_PRESET) {
        // EQ Preset Information
        if (data.length >= 1) {
            const numBands = data[0];
            console.log(`     Frequency Bands: ${numBands}`);

            if (data.length >= 1 + numBands * 2) {
                const freqs = [];
                for (let i = 0; i < numBands; i++) {
                    const freq = (data[1 + i*2] << 8) | data[2 + i*2];
                    freqs.push(freq);
                }
                console.log(`     Frequencies: [${freqs.join(", ")}] Hz`);
            }
        }
    } else {
        // Unknown attribute, show hex
        console.log(`     Data: ${bytesToHex(data)}`);
    }
}

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function(byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2).toUpperCase();
    }).join(' ');
}

function signedByte(byte) {
    return byte > 127 ? byte - 256 : byte;
}

function getOpCodeName(opCode) {
    const names = {
        0x07: "GET_SYS_INFO",
        0x08: "SET_SYS_INFO"
    };
    return names[opCode] || "UNKNOWN";
}

function getAttrTypeName(type) {
    const names = {
        0x04: "EQ",
        0x0B: "BASS_TREBLE",
        0x0C: "EQ_PRESET",
        0x11: "SOUND_CARD_EQ_FREQ",
        0x12: "SOUND_CARD_EQ_VALUE"
    };
    return names[type] || "UNKNOWN";
}

console.log("\n✅ RCSP capture ready!");
console.log("💡 Waiting for Bluetooth traffic...\n");
