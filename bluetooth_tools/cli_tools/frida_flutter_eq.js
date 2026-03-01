/**
 * Flutter App EQ/PEQ Capture
 *
 * Specialized script for capturing EQ operations in Flutter apps
 * Combines Flutter MethodChannel hooks with Bluetooth protocol capture
 *
 * Features:
 * - Flutter MethodChannel monitoring
 * - Dart FFI hooks
 * - High-level EQ parameter capture
 * - Low-level Bluetooth packet correlation
 */

console.log("🎨 Flutter EQ Capture v1.0");
console.log("="*80);

Java.perform(function() {
    console.log("📱 Initializing Flutter + Bluetooth hooks...\n");

    // ====================================================================
    // FLUTTER METHOD CHANNEL HOOKS
    // ====================================================================

    try {
        const MethodChannel = Java.use("io.flutter.plugin.common.MethodChannel");
        const MethodCallHandler = Java.use("io.flutter.plugin.common.MethodChannel$MethodCallHandler");

        // Hook MethodChannel.invokeMethod
        MethodChannel.invokeMethod.overload('java.lang.String', 'java.lang.Object').implementation = function(method, arguments) {
            console.log("\n" + "▶".repeat(80));
            console.log("🎨 Flutter MethodChannel Call");
            console.log("▶".repeat(80));
            console.log("Method: " + method);

            // Log arguments if it's EQ-related
            if (method.toLowerCase().includes("eq") ||
                method.toLowerCase().includes("peq") ||
                method.toLowerCase().includes("preset") ||
                method.toLowerCase().includes("audio")) {

                try {
                    if (arguments) {
                        const argStr = arguments.toString();
                        console.log("Arguments: " + argStr);

                        // Try to parse as HashMap (common for EQ data)
                        parseFlutterArguments(arguments);
                    }
                } catch(e) {
                    console.log("⚠️  Could not parse arguments: " + e.message);
                }
            }

            console.log("▶".repeat(80));

            return this.invokeMethod(method, arguments);
        };

        console.log("✅ Flutter MethodChannel hooks installed");
    } catch(e) {
        console.log("⚠️  Flutter MethodChannel hooks failed: " + e.message);
    }

    // ====================================================================
    // BLUETOOTH HOOKS (Same as universal)
    // ====================================================================

    try {
        // SPP Output
        const OutputStream = Java.use("java.io.OutputStream");

        OutputStream.write.overload('[B').implementation = function(bytes) {
            console.log("\n" + "!".repeat(80));
            console.log("📤 SPP TX (Bluetooth Packet)");
            console.log("!".repeat(80));
            console.log("Length: " + bytes.length);
            console.log("Hex: " + bytesToHex(bytes));

            parseProtocol(bytes, "TX");

            console.log("!".repeat(80));
            return this.write(bytes);
        };

        // SPP Input
        const InputStream = Java.use("java.io.InputStream");

        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, 0, result);
                console.log("\n" + "!".repeat(80));
                console.log("📥 SPP RX (Bluetooth Packet)");
                console.log("!".repeat(80));
                console.log("Length: " + result);
                console.log("Hex: " + bytesToHex(data));

                parseProtocol(data, "RX");

                console.log("!".repeat(80));
            }
            return result;
        };

        console.log("✅ Bluetooth (SPP) hooks installed");
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
                console.log("\n" + "=".repeat(80));
                console.log("📤 BLE GATT TX");
                console.log("=".repeat(80));
                console.log("UUID: " + uuid);
                console.log("Hex: " + bytesToHex(value));

                parseProtocol(value, "TX");

                console.log("=".repeat(80));
            }

            return this.writeCharacteristic(characteristic);
        };

        console.log("✅ BLE GATT hooks installed");
    } catch(e) {
        console.log("⚠️  BLE GATT hooks failed: " + e.message);
    }

    // ====================================================================
    // HELPER FUNCTIONS
    // ====================================================================

    function parseFlutterArguments(args) {
        try {
            // Check if it's a HashMap
            const HashMap = Java.use("java.util.HashMap");
            if (HashMap.isInstance(args)) {
                const map = Java.cast(args, HashMap);
                const keySet = map.keySet();
                const iterator = keySet.iterator();

                console.log("   Flutter Data (HashMap):");

                while (iterator.hasNext()) {
                    const key = iterator.next();
                    const value = map.get(key);

                    console.log("   • " + key + ": " + value);

                    // Try to parse EQ-specific data
                    if (key.toLowerCase().includes("freq") ||
                        key.toLowerCase().includes("gain") ||
                        key.toLowerCase().includes("q")) {

                        // Try to parse as array
                        try {
                            if (value.getClass().isArray()) {
                                const ArrayClass = Java.use("java.lang.reflect.Array");
                                const length = ArrayClass.getLength(value);

                                console.log("     Array length: " + length);

                                for (let i = 0; i < Math.min(length, 10); i++) {
                                    const element = ArrayClass.get(value, i);
                                    console.log("     [" + i + "]: " + element);
                                }
                            }
                        } catch(e) {}
                    }
                }
            }

            // Check if it's an ArrayList
            const ArrayList = Java.use("java.util.ArrayList");
            if (ArrayList.isInstance(args)) {
                const list = Java.cast(args, ArrayList);
                console.log("   Flutter Data (ArrayList), size: " + list.size());

                for (let i = 0; i < Math.min(list.size(), 10); i++) {
                    const item = list.get(i);
                    console.log("   [" + i + "]: " + item);
                }
            }

        } catch(e) {
            console.log("   ⚠️  Could not parse Flutter arguments: " + e.message);
        }
    }

    function bytesToHex(bytes) {
        const arr = Array.prototype.slice.call(bytes);
        return arr.map(function(b) {
            return ("0" + (b & 0xFF).toString(16).toUpperCase()).slice(-2);
        }).join(" ");
    }

    function parseProtocol(bytes, direction) {
        if (bytes.length < 8) return;

        const start = bytes[0] & 0xFF;
        const version = bytes[1] & 0xFF;

        // Standard Moondrop-like protocol
        if (start === 0xFF && version === 0x04) {
            const length = ((bytes[2] & 0xFF) << 8) | (bytes[3] & 0xFF);
            const command = bytes[7] & 0xFF;

            console.log("   ┌─ Protocol Decoded ─┐");
            console.log("   │ Type:    Moondrop-like");
            console.log("   │ Length:  " + length);
            console.log("   │ Command: 0x" + command.toString(16).toUpperCase());

            switch(command) {
                case 0x03:
                    console.log("   │ Action:  Enable/Disable EQ");
                    if (bytes.length > 8) {
                        console.log("   │ Enable:  " + (bytes[8] ? "YES" : "NO"));
                    }
                    break;

                case 0x05:
                    console.log("   │ Action:  Query EQ");
                    if (bytes.length > 10 && direction === "RX") {
                        const bandCount = ((bytes[8] & 0xFF) << 8) | (bytes[9] & 0xFF);
                        console.log("   │ Bands:   " + bandCount);
                    }
                    break;

                case 0x06:
                    console.log("   │ Action:  Set EQ");
                    if (bytes.length > 10) {
                        const bandCount = ((bytes[8] & 0xFF) << 8) | (bytes[9] & 0xFF);
                        console.log("   │ Bands:   " + bandCount);
                    }
                    break;
            }

            console.log("   └─────────────────────┘");
        }
    }

    console.log("\n✅ Flutter + Bluetooth monitoring active!");
    console.log("📡 Waiting for EQ operations...\n");
    console.log("💡 Tips:");
    console.log("   - Change EQ settings in the app");
    console.log("   - Try different presets");
    console.log("   - Watch for Flutter method calls followed by Bluetooth packets\n");
});
