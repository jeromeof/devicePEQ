/**
 * Universal Bluetooth Protocol Capture
 *
 * Captures both Classic Bluetooth (SPP) and BLE GATT traffic
 * Designed to work with most Android Bluetooth audio apps
 *
 * Features:
 * - SPP (Serial Port Profile) capture
 * - BLE GATT characteristic read/write
 * - Automatic packet parsing
 * - EQ command detection
 * - Hex and decimal output
 */

console.log("🎧 Universal Bluetooth Capture v1.0");
console.log("="*80);

Java.perform(function() {
    console.log("📱 Initializing hooks...\n");

    // ====================================================================
    // CLASSIC BLUETOOTH (SPP) HOOKS
    // ====================================================================

    try {
        // Hook OutputStream for TX (to device)
        const OutputStream = Java.use("java.io.OutputStream");

        OutputStream.write.overload('[B').implementation = function(bytes) {
            logPacket("SPP TX", "OutputStream.write", bytes);
            return this.write(bytes);
        };

        OutputStream.write.overload('[B', 'int', 'int').implementation = function(bytes, offset, length) {
            const data = Array.prototype.slice.call(bytes, offset, offset + length);
            logPacket("SPP TX", "OutputStream.write(offset)", data);
            return this.write(bytes, offset, length);
        };

        // Hook InputStream for RX (from device)
        const InputStream = Java.use("java.io.InputStream");

        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, 0, result);
                logPacket("SPP RX", "InputStream.read", data);
            }
            return result;
        };

        InputStream.read.overload('[B', 'int', 'int').implementation = function(buffer, offset, length) {
            const result = this.read(buffer, offset, length);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, offset, offset + result);
                logPacket("SPP RX", "InputStream.read(offset)", data);
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

                    parseProtocol(value, "TX");

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

                // Read happens async, log when value is available
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

                            parseProtocol(value, "RX");

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

                    parseProtocol(value, "RX");

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

    function logPacket(type, method, bytes) {
        if (!bytes || bytes.length === 0) return;

        console.log("\n" + "!".repeat(80));
        console.log("📡 " + type + " (" + method + ")");
        console.log("!".repeat(80));
        console.log("Length: " + bytes.length);
        console.log("Hex: " + bytesToHex(bytes));
        console.log("Dec: [" + Array.prototype.slice.call(bytes).join(", ") + "]");

        parseProtocol(bytes, type.includes("TX") ? "TX" : "RX");

        console.log("!".repeat(80));
    }

    function bytesToHex(bytes) {
        const arr = Array.prototype.slice.call(bytes);
        return arr.map(function(b) {
            const byte = b & 0xFF;
            return ("0" + byte.toString(16).toUpperCase()).slice(-2);
        }).join(" ");
    }

    function parseProtocol(bytes, direction) {
        if (bytes.length < 8) return;

        const start = bytes[0] & 0xFF;
        const version = bytes[1] & 0xFF;

        // Check for common protocol patterns

        // Pattern 1: FF 04 ... (Moondrop-like)
        if (start === 0xFF && version === 0x04) {
            parseMoondropProtocol(bytes, direction);
            return;
        }

        // Pattern 2: Airoha protocol
        if (start === 0x05 && version === 0x5A) {
            parseAirohaProtocol(bytes, direction);
            return;
        }

        // Pattern 3: Other custom protocols
        console.log("   ⚠️  Unknown protocol pattern");
    }

    function parseMoondropProtocol(bytes, direction) {
        const length = ((bytes[2] & 0xFF) << 8) | (bytes[3] & 0xFF);
        const deviceId = ((bytes[4] & 0xFF) << 8) | (bytes[5] & 0xFF);
        const dir = bytes[6] & 0xFF;
        const command = bytes[7] & 0xFF;

        console.log("   ┌─ Moondrop Protocol ─┐");
        console.log("   │ Start:     0xFF");
        console.log("   │ Version:   0x04");
        console.log("   │ Length:    " + length);
        console.log("   │ Device ID: 0x" + deviceId.toString(16).toUpperCase().padStart(4, "0"));
        console.log("   │ Direction: 0x" + dir.toString(16).toUpperCase() + " (" + (dir === 0x0A ? "TO device" : "FROM device") + ")");
        console.log("   │ Command:   0x" + command.toString(16).toUpperCase());

        // Decode specific commands
        switch(command) {
            case 0x03:
                const enable = bytes.length > 8 ? (bytes[8] & 0xFF) : null;
                console.log("   │ Function:  Enable/Disable EQ");
                if (enable !== null) {
                    console.log("   │ Enable:    " + (enable ? "YES" : "NO"));
                }
                break;

            case 0x05:
                console.log("   │ Function:  Query EQ");
                if (bytes.length > 8) {
                    const queryType = ((bytes[8] & 0xFF) << 8) | (bytes[9] & 0xFF);
                    console.log("   │ Query:     0x" + queryType.toString(16).toUpperCase());

                    // If this is a response with band data
                    if (bytes.length > 10 && direction === "RX") {
                        parseEQBands(bytes.slice(8));
                    }
                }
                break;

            case 0x06:
                console.log("   │ Function:  Set EQ");
                if (bytes.length > 10) {
                    parseEQBands(bytes.slice(8));
                }
                break;

            default:
                console.log("   │ Function:  Unknown");
        }

        if (bytes.length > 8) {
            const payload = Array.prototype.slice.call(bytes, 8);
            const payloadHex = payload.map(b => ("0" + (b & 0xFF).toString(16).toUpperCase()).slice(-2)).join(" ");
            console.log("   │ Payload:   " + payloadHex);
        }

        console.log("   └──────────────────────┘");
    }

    function parseEQBands(payload) {
        if (payload.length < 2) return;

        const bandCount = ((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF);
        console.log("   │ Band Count: " + bandCount);

        const bandData = payload.slice(2);
        console.log("   │ Band Data:  " + bandData.length + " bytes");

        // Try to parse bands (5 bands expected, shifted gain encoding)
        let offset = 0;
        for (let i = 0; i < Math.min(5, bandCount + 1); i++) {
            const bandLength = (i === 4) ? 6 : 7;
            if (offset + bandLength > bandData.length) break;

            const band = bandData.slice(offset, offset + bandLength);
            const gainRaw = ((band[0] & 0xFF) << 8) | (band[1] & 0xFF);
            const gainSigned = gainRaw > 32767 ? gainRaw - 65536 : gainRaw;
            const freq = ((band[2] & 0xFF) << 8) | (band[3] & 0xFF);
            const qRaw = ((band[4] & 0xFF) << 8) | (band[5] & 0xFF);
            const q = qRaw / 4096.0;

            // Note: gain is shifted - this is actually for previous band
            const bandNum = i === 0 ? 1 : i;
            console.log("   │   Band " + bandNum + ": " + freq + " Hz, Q=" + q.toFixed(2));

            if (i > 0) {
                const gainDb = gainSigned / 60.0;
                console.log("   │          Gain: " + gainDb.toFixed(1) + " dB (for band " + (i) + ")");
            }

            offset += bandLength;
        }
    }

    function parseAirohaProtocol(bytes, direction) {
        console.log("   ┌─ Airoha Protocol ─┐");
        console.log("   │ Start:   0x05");
        console.log("   │ Type:    0x5A");
        console.log("   │ Length:  " + bytes.length);
        console.log("   │ Raw:     " + bytesToHex(bytes));
        console.log("   └────────────────────┘");
        console.log("   ⚠️  Airoha protocol detected - use --airoha mode for detailed parsing");
    }

    console.log("\n✅ All hooks active!");
    console.log("📡 Monitoring Bluetooth traffic...\n");
    console.log("💡 Tip: Perform EQ operations in the app to capture packets\n");
});
