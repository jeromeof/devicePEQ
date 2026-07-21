// Simple test to verify hooks are working
console.log("🔍 Testing Edifier hooks...");

Java.perform(function() {
    console.log("✅ Java.perform started");

    // Try to hook BluetoothSocket for Classic Bluetooth
    try {
        const BluetoothSocket = Java.use("android.bluetooth.BluetoothSocket");
        console.log("✅ Found BluetoothSocket class");

        // Hook getOutputStream
        const OutputStream = Java.use("java.io.OutputStream");
        OutputStream.write.overload('[B').implementation = function(bytes) {
            console.log("\n📤 SPP TX: " + bytes.length + " bytes");
            console.log("Hex: " + Array.prototype.slice.call(bytes).map(b => ("0" + (b & 0xFF).toString(16).toUpperCase()).slice(-2)).join(" "));
            return this.write(bytes);
        };
        console.log("✅ Hooked OutputStream.write");

        // Hook getInputStream
        const InputStream = Java.use("java.io.InputStream");
        InputStream.read.overload('[B').implementation = function(buffer) {
            const result = this.read(buffer);
            if (result > 0) {
                const data = Array.prototype.slice.call(buffer, 0, result);
                console.log("\n📥 SPP RX: " + result + " bytes");
                console.log("Hex: " + data.map(b => ("0" + (b & 0xFF).toString(16).toUpperCase()).slice(-2)).join(" "));
            }
            return result;
        };
        console.log("✅ Hooked InputStream.read");

    } catch(e) {
        console.log("⚠️  BluetoothSocket hook failed: " + e);
    }

    console.log("\n📡 Hooks installed - waiting for Bluetooth activity...");
    console.log("💡 Try changing volume or EQ settings in the app\n");
});
