/**
 * Edifier W830NB Protocol Capture
 *
 * Captures Edifier ConnectX protocol for W830NB and similar devices
 * Protocol details documented in EDIFIER_PROTOCOL_DOCUMENTATION.md
 *
 * Features:
 * - BLE GATT and SPP (Serial Port) capture
 * - Protocol V1 and V2 support
 * - Automatic packet parsing
 * - PEQ/EQ command detection
 * - CRC verification
 */

console.log("🎧 Edifier W830NB Protocol Capture v1.0");
console.log("="*80);

Java.perform(function() {
    console.log("📱 Initializing Edifier hooks...\n");

    // ====================================================================
    // PROTOCOL CONSTANTS
    // ====================================================================

    const HEADER_SEND = 0xBB;        // Commands TO device
    const HEADER_RECEIVE = 0xCC;      // Responses FROM device
    const HEADER_ALT = 0xAA;          // Alternative header
    const APP_CODE = 0xEC;            // Standard app code (236)

    // Command indices
    const CMD = {
        BATTERY: 0xD0,              // 208
        VERSION: 0xC6,              // 198
        DEVICE_STATE: 0xF2,         // 242
        ANC_QUERY: 0xCC,            // 204
        ANC_SET: 0xC1,              // 193
        EQ_QUERY: 0xD5,             // 213
        EQ_SET: 0xC4,               // 196
        CUSTOM_EQ_GET: 0x43,        // 67
        CUSTOM_EQ_SET_BAND: 0x44,   // 68
        CUSTOM_EQ_RESET: 0x45,      // 69
        CUSTOM_EQ_SET_FULL: 0x46,   // 70
        VOLUME_GET: 0x66,           // 102
        VOLUME_SET: 0x67            // 103
    };

    // Filter types
    const FILTER_TYPE = {
        0: "Peak/Bell",
        1: "Low Shelf",
        2: "High Shelf",
        3: "Low Pass",
        4: "High Pass",
        5: "Notch",
        6: "All Pass",
        7: "Band Pass"
    };

    // ====================================================================
    // CLASSIC BLUETOOTH (SPP) HOOKS
    // ====================================================================

    try {
        const OutputStream = Java.use("java.io.OutputStream");

        OutputStream.write.overload('[B').implementation = function(bytes) {
            logPacket("SPP TX", bytes, "OutputStream.write");
            return this.write(bytes);
        };

        OutputStream.write.overload('[B', 'int', 'int').implementation = function(bytes, offset, length) {
            const data = Array.prototype.slice.call(bytes, offset, offset + length);
            logPacket("SPP TX", data, "OutputStream.write(offset)");
            return this.write(bytes, offset, length);
        };

        const InputStream = Java.use("java.io.InputStream");

        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, 0, result);
                logPacket("SPP RX", data, "InputStream.read");
            }
            return result;
        };

        InputStream.read.overload('[B', 'int', 'int').implementation = function(buffer, offset, length) {
            const result = this.read(buffer, offset, length);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, offset, offset + result);
                logPacket("SPP RX", data, "InputStream.read(offset)");
            }
            return result;
        };

        console.log("✅ Classic Bluetooth (SPP) hooks installed");
    } catch(e) {
        console.log("⚠️  SPP hooks failed: " + e.message);
    }

    // ====================================================================
    // BLE GATT HOOKS
    // ====================================================================

    try {
        const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");
        const BluetoothGattCharacteristic = Java.use("android.bluetooth.BluetoothGattCharacteristic");

        // Hook writeCharacteristic (TX)
        BluetoothGatt.writeCharacteristic.overload('android.bluetooth.BluetoothGattCharacteristic').implementation = function(characteristic) {
            const uuid = characteristic.getUuid().toString();

            try {
                const value = characteristic.getValue();
                if (value && value.length > 0) {
                    console.log("\n" + "=".repeat(80));
                    console.log("📤 BLE GATT TX");
                    console.log("=".repeat(80));
                    console.log("Characteristic: " + uuid);
                    console.log("Length: " + value.length);
                    console.log("Hex: " + bytesToHex(value));
                    console.log("Dec: [" + Array.prototype.slice.call(value).join(", ") + "]");

                    parseEdifierProtocol(value, "TX");

                    console.log("=".repeat(80));
                }
            } catch(e) {
                console.log("⚠️  Could not read characteristic value: " + e.message);
            }

            return this.writeCharacteristic(characteristic);
        };

        // Hook readCharacteristic (RX)
        BluetoothGatt.readCharacteristic.overload('android.bluetooth.BluetoothGattCharacteristic').implementation = function(characteristic) {
            const result = this.readCharacteristic(characteristic);

            if (result) {
                const uuid = characteristic.getUuid().toString();

                setTimeout(function() {
                    try {
                        const value = characteristic.getValue();
                        if (value && value.length > 0) {
                            console.log("\n" + "=".repeat(80));
                            console.log("📥 BLE GATT RX (read)");
                            console.log("=".repeat(80));
                            console.log("Characteristic: " + uuid);
                            console.log("Length: " + value.length);
                            console.log("Hex: " + bytesToHex(value));
                            console.log("Dec: [" + Array.prototype.slice.call(value).join(", ") + "]");

                            parseEdifierProtocol(value, "RX");

                            console.log("=".repeat(80));
                        }
                    } catch(e) {}
                }, 100);
            }

            return result;
        };

        // Hook onCharacteristicChanged (notifications)
        const BluetoothGattCallback = Java.use("android.bluetooth.BluetoothGattCallback");

        BluetoothGattCallback.onCharacteristicChanged.overload('android.bluetooth.BluetoothGatt', 'android.bluetooth.BluetoothGattCharacteristic').implementation = function(gatt, characteristic) {
            const uuid = characteristic.getUuid().toString();

            try {
                const value = characteristic.getValue();
                if (value && value.length > 0) {
                    console.log("\n" + "=".repeat(80));
                    console.log("📥 BLE GATT RX (notification)");
                    console.log("=".repeat(80));
                    console.log("Characteristic: " + uuid);
                    console.log("Length: " + value.length);
                    console.log("Hex: " + bytesToHex(value));
                    console.log("Dec: [" + Array.prototype.slice.call(value).join(", ") + "]");

                    parseEdifierProtocol(value, "RX");

                    console.log("=".repeat(80));
                }
            } catch(e) {}

            return this.onCharacteristicChanged(gatt, characteristic);
        };

        console.log("✅ BLE GATT hooks installed");
    } catch(e) {
        console.log("⚠️  BLE GATT hooks failed: " + e.message);
    }

    // ====================================================================
    // HELPER FUNCTIONS
    // ====================================================================

    function logPacket(type, bytes, method) {
        if (!bytes || bytes.length === 0) return;

        console.log("\n" + "!".repeat(80));
        console.log("📡 " + type + " (" + method + ")");
        console.log("!".repeat(80));
        console.log("Length: " + bytes.length);
        console.log("Hex: " + bytesToHex(bytes));
        console.log("Dec: [" + Array.prototype.slice.call(bytes).join(", ") + "]");

        parseEdifierProtocol(bytes, type.includes("TX") ? "TX" : "RX");

        console.log("!".repeat(80));
    }

    function bytesToHex(bytes) {
        const arr = Array.prototype.slice.call(bytes);
        return arr.map(function(b) {
            const byte = b & 0xFF;
            return ("0" + byte.toString(16).toUpperCase()).slice(-2);
        }).join(" ");
    }

    function parseEdifierProtocol(bytes, direction) {
        if (bytes.length < 6) {
            console.log("   ⚠️  Packet too short (min 6 bytes required)");
            return;
        }

        const header = bytes[0] & 0xFF;
        const appCode = bytes[1] & 0xFF;
        const command = bytes[2] & 0xFF;
        const lengthHigh = bytes[3] & 0xFF;
        const lengthLow = bytes[4] & 0xFF;
        const payloadLength = (lengthHigh << 8) | lengthLow;
        const expectedLength = 6 + payloadLength; // header + appCode + cmd + len(2) + payload + crc
        const crc = bytes.length > 5 ? bytes[bytes.length - 1] & 0xFF : 0;

        // Verify packet structure
        if (bytes.length !== expectedLength) {
            console.log("   ⚠️  Length mismatch: expected " + expectedLength + ", got " + bytes.length);
        }

        // Detect protocol version
        let protocolVersion = "V2";
        if (header !== HEADER_SEND && header !== HEADER_RECEIVE && header !== HEADER_ALT) {
            protocolVersion = "Unknown";
        }

        console.log("   ┌─ Edifier Protocol (" + protocolVersion + ") ─┐");
        console.log("   │ Direction:  " + direction);
        console.log("   │ Header:     0x" + header.toString(16).toUpperCase().padStart(2, "0") + " (" + getHeaderType(header) + ")");
        console.log("   │ AppCode:    0x" + appCode.toString(16).toUpperCase().padStart(2, "0") + " (" + appCode + ")");
        console.log("   │ Command:    0x" + command.toString(16).toUpperCase().padStart(2, "0") + " (" + command + ") - " + getCommandName(command));
        console.log("   │ Length:     " + payloadLength + " bytes payload");
        console.log("   │ CRC:        0x" + crc.toString(16).toUpperCase().padStart(2, "0"));

        // Verify CRC
        const calculatedCrc = calculateCRC(bytes);
        const crcValid = calculatedCrc === crc;
        console.log("   │ CRC Valid:  " + (crcValid ? "✅ YES" : "❌ NO (expected 0x" + calculatedCrc.toString(16).toUpperCase().padStart(2, "0") + ")"));

        // Extract payload (convert Java byte array to JS array)
        const payload = Array.prototype.slice.call(bytes, 5, 5 + payloadLength);

        // Parse command-specific payload
        parseCommandPayload(command, payload, direction);

        console.log("   └" + "─".repeat(40) + "┘");
    }

    function getHeaderType(header) {
        if (header === HEADER_SEND) return "TO device";
        if (header === HEADER_RECEIVE) return "FROM device";
        if (header === HEADER_ALT) return "Alternative";
        return "Unknown";
    }

    function getCommandName(cmd) {
        for (let name in CMD) {
            if (CMD[name] === cmd) {
                return name;
            }
        }
        return "UNKNOWN";
    }

    function calculateCRC(bytes) {
        // CRC is sum of all bytes (excluding CRC itself) & 0xFF
        let sum = 0;
        for (let i = 0; i < bytes.length - 1; i++) {
            sum += (bytes[i] & 0xFF);
        }
        return sum & 0xFF;
    }

    function parseCommandPayload(command, payload, direction) {
        const payloadArr = Array.prototype.slice.call(payload);

        if (payloadArr.length === 0) {
            console.log("   │ Payload:    (empty - query command)");
            return;
        }

        switch(command) {
            case CMD.BATTERY:
                if (direction === "RX" && payloadArr.length >= 1) {
                    console.log("   │ Battery:    " + payloadArr[0] + "%");
                }
                break;

            case CMD.VOLUME_GET:
            case CMD.VOLUME_SET:
                if (payloadArr.length >= 1) {
                    console.log("   │ Volume:     " + payloadArr[0] + " (0-100)");
                }
                break;

            case CMD.ANC_QUERY:
            case CMD.ANC_SET:
                if (payloadArr.length >= 1) {
                    console.log("   │ ANC Mode:   " + payloadArr[0]);
                    if (payloadArr.length >= 2) {
                        console.log("   │ ANC Level:  " + payloadArr[1]);
                    }
                    if (payloadArr.length >= 3) {
                        console.log("   │ ANC Prog:   " + payloadArr[2]);
                    }
                }
                break;

            case CMD.EQ_QUERY:
            case CMD.EQ_SET:
                if (payloadArr.length >= 1) {
                    console.log("   │ EQ Preset:  " + payloadArr[0]);
                }
                break;

            case CMD.CUSTOM_EQ_GET:
                if (direction === "RX") {
                    parseCustomEQ(payloadArr);
                }
                break;

            case CMD.CUSTOM_EQ_SET_BAND:
                if (payloadArr.length >= 6) {
                    parseEQBand(payloadArr, 0);
                }
                break;

            case CMD.CUSTOM_EQ_SET_FULL:
                parseFullEQProfile(payloadArr);
                break;

            case CMD.CUSTOM_EQ_RESET:
                console.log("   │ Action:     Reset EQ to default");
                break;

            case CMD.VERSION:
                if (direction === "RX" && payloadArr.length > 0) {
                    const versionStr = bytesToAscii(payloadArr);
                    console.log("   │ Version:    " + versionStr);
                }
                break;

            default:
                console.log("   │ Payload:    " + bytesToHex(payload));
                console.log("   │ Payload Dec:[" + payloadArr.join(", ") + "]");
        }
    }

    function parseCustomEQ(payload) {
        // Expected: 36 bytes (2-byte header + 4 bands × 6 bytes + 10 bytes extra) for W830NB
        const expectedBytes = 36;

        if (payload.length < expectedBytes) {
            console.log("   │ EQ Data:    Invalid length (" + payload.length + " bytes, expected " + expectedBytes + ")");
            return;
        }

        // First 2 bytes appear to be a header
        const header1 = payload[0] & 0xFF;
        const header2 = payload[1] & 0xFF;
        console.log("   │ Header:     0x" + header1.toString(16).toUpperCase().padStart(2, "0") + " 0x" + header2.toString(16).toUpperCase().padStart(2, "0"));
        console.log("   │ Custom EQ:  4 main bands + 2 extra");
        console.log("   │");

        // Parse 4 main bands (6 bytes each, starting at offset 2)
        for (let i = 0; i < 4; i++) {
            parseEQBandFromFullPayload(payload, i, 2 + (i * 6));
        }

        // Last 10 bytes (bands 4-5, different structure)
        console.log("   │");
        console.log("   │ Bands 4-5:  " + bytesToHex(payload.slice(26, 36)));
    }

    function parseEQBand(payload, bandIndex) {
        const offset = bandIndex * 6;

        if (offset + 6 > payload.length) {
            console.log("   │   Band " + bandIndex + ": Insufficient data");
            return;
        }

        const band = payload[offset] & 0xFF;
        const filter = payload[offset + 1] & 0xFF;
        const freqHigh = payload[offset + 2] & 0xFF;
        const freqLow = payload[offset + 3] & 0xFF;
        const gain = payload[offset + 4] & 0xFF;
        const q = payload[offset + 5] & 0xFF;

        const frequency = (freqHigh << 8) | freqLow;
        const gainDb = gain - 6; // Convert 0-12 scale to -6dB to +6dB
        const filterName = FILTER_TYPE[filter] || "Unknown";

        console.log("   │   Band " + band + ": " +
                    frequency.toString().padStart(5, " ") + " Hz | " +
                    (gainDb >= 0 ? "+" : "") + gainDb.toString().padStart(2, " ") + " dB | " +
                    "Q=" + q.toString().padStart(3, " ") + " | " +
                    filterName);
    }

    function parseEQBandFromFullPayload(payload, bandIndex, offset) {
        if (offset + 6 > payload.length) {
            console.log("   │   Filter " + bandIndex + ": Insufficient data");
            return;
        }

        const bandId = payload[offset] & 0xFF;
        const param1 = payload[offset + 1] & 0xFF;
        const freqByte1 = payload[offset + 2] & 0xFF;
        const freqByte2 = payload[offset + 3] & 0xFF;
        const gainByte = payload[offset + 4] & 0xFF;
        const terminator = payload[offset + 5] & 0xFF;

        // Decode gain: 0xA9 (169) = 0dB, 4 units per dB
        const gainDb = (gainByte - 169) / 4.0;

        // Frequency encoding TBD - for now show raw bytes
        const freqHex = "0x" + freqByte1.toString(16).toUpperCase().padStart(2, "0") +
                        " 0x" + freqByte2.toString(16).toUpperCase().padStart(2, "0");

        console.log("   │   Filter " + bandIndex + ": " +
                    "Freq[" + freqHex + "] | " +
                    (gainDb >= 0 ? "+" : "") + gainDb.toFixed(1) + " dB | " +
                    "BandID=0x" + bandId.toString(16).toUpperCase() + " | " +
                    "Term=0x" + terminator.toString(16).toUpperCase());
    }

    function parseFullEQProfile(payload) {
        const expectedBytes = 36;  // 6 bands × 6 bytes
        const numBands = 6;

        console.log("   │ Full EQ Profile:");
        console.log("   │");

        // Parse band data (6 bands × 6 bytes = 36 bytes)
        if (payload.length >= expectedBytes) {
            for (let i = 0; i < numBands; i++) {
                parseEQBand(payload, i);
            }

            // Timestamp (4 bytes after bands, if present)
            const timestampOffset = expectedBytes;
            if (payload.length >= timestampOffset + 4) {
                const ts0 = payload[timestampOffset] & 0xFF;
                const ts1 = payload[timestampOffset + 1] & 0xFF;
                const ts2 = payload[timestampOffset + 2] & 0xFF;
                const ts3 = payload[timestampOffset + 3] & 0xFF;
                const timestamp = (ts0 << 24) | (ts1 << 16) | (ts2 << 8) | ts3;
                console.log("   │ Timestamp:  " + timestamp);
            }

            // Profile name (remaining bytes, UTF-8)
            if (payload.length > 64) {
                const nameBytes = payload.slice(64);
                const profileName = bytesToUtf8(nameBytes);
                console.log("   │ Profile:    \"" + profileName + "\"");
            }
        } else {
            console.log("   │ Error:      Insufficient data (" + payload.length + " bytes, expected " + expectedBytes + "+)");
        }
    }

    function bytesToAscii(bytes) {
        return bytes.map(function(b) {
            const char = b & 0xFF;
            return char >= 32 && char < 127 ? String.fromCharCode(char) : '.';
        }).join('');
    }

    function bytesToUtf8(bytes) {
        try {
            const arr = Array.prototype.slice.call(bytes);
            return decodeURIComponent(escape(String.fromCharCode.apply(null, arr)));
        } catch(e) {
            return bytesToAscii(bytes);
        }
    }

    console.log("\n✅ All Edifier hooks active!");
    console.log("📡 Monitoring Bluetooth traffic for W830NB...\n");
    console.log("💡 Actions to try in the Edifier app:");
    console.log("   - Check battery level");
    console.log("   - Change volume");
    console.log("   - Switch ANC modes");
    console.log("   - Change EQ presets");
    console.log("   - Modify custom EQ settings");
    console.log("   - Read/write individual EQ bands\n");
});
