/**
 * Frida script to capture Earfun Tune Pro Bluetooth traffic
 * Focus: Initial connection and any EQ-related queries
 */

console.log("[*] Earfun Connection Monitor - Starting...");

// Hook BluetoothSocket OutputStream write
const BluetoothSocket = Java.use("android.bluetooth.BluetoothSocket");
BluetoothSocket.getOutputStream.implementation = function() {
    const stream = this.getOutputStream();
    const OutputStream = Java.use("java.io.OutputStream");

    stream.write.overload('[B').implementation = function(bytes) {
        if (bytes && bytes.length > 0) {
            let hexStr = "";
            for (let i = 0; i < bytes.length; i++) {
                hexStr += ("0" + (bytes[i] & 0xFF).toString(16)).slice(-2).toUpperCase() + " ";
            }

            const timestamp = new Date().toLocaleTimeString();

            // Check if it's an EQ command
            if (bytes.length >= 4 && bytes[0] === 0xEF && bytes[1] === 0x20) {
                const cmd = bytes[2] & 0xFF;
                if (cmd === 0x95) {
                    console.log(`\n[${timestamp}] 📤 TX (EQ WRITE): ${hexStr.trim()}`);
                } else if (cmd === 0x94 || cmd === 0x96) {
                    console.log(`\n[${timestamp}] 📥 TX (POSSIBLE EQ READ): ${hexStr.trim()}`);
                } else {
                    console.log(`\n[${timestamp}] 📤 TX (0x${cmd.toString(16)}): ${hexStr.trim()}`);
                }
            } else {
                console.log(`\n[${timestamp}] 📤 TX: ${hexStr.trim()}`);
            }
        }
        return this.write(bytes);
    };

    return stream;
};

// Hook InputStream read to capture responses
const BufferedInputStream = Java.use("java.io.BufferedInputStream");
BufferedInputStream.read.overload('[B', 'int', 'int').implementation = function(buffer, offset, length) {
    const bytesRead = this.read(buffer, offset, length);

    if (bytesRead > 0) {
        let hexStr = "";
        for (let i = offset; i < offset + bytesRead; i++) {
            hexStr += ("0" + (buffer[i] & 0xFF).toString(16)).slice(-2).toUpperCase() + " ";
        }

        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n[${timestamp}] 📥 RX: ${hexStr.trim()}`);
    }

    return bytesRead;
};

// Hook EarfunProtocolParser methods to see what's called
try {
    const EarfunParser = Java.use("com.corelink.earfun.device.protocol.headset.EarfunProtocolParser");

    // Monitor getAllInfo - might include EQ state
    EarfunParser.getAllInfo.implementation = function() {
        console.log("\n[*] 🔍 getAllInfo() called - might query device state");
        return this.getAllInfo();
    };

    // Monitor buildEqCommond - when writing EQ
    EarfunParser.buildEqCommond.implementation = function(payload) {
        console.log("\n[*] 🎵 buildEqCommond() called with payload length:", payload.length);
        return this.buildEqCommond(payload);
    };

    // Monitor setData - when parsing responses
    EarfunParser.setData.overload('[B').implementation = function(data) {
        if (data && data.length >= 4) {
            const cmd1 = data[1] & 0xFF;
            const cmd2 = data[2] & 0xFF;
            console.log(`\n[*] 📨 setData() parsing response: cmd1=0x${cmd1.toString(16)} cmd2=0x${cmd2.toString(16)}`);
        }
        return this.setData(data);
    };

    console.log("[*] ✅ EarfunProtocolParser hooks installed");
} catch (e) {
    console.log("[!] Could not hook EarfunProtocolParser:", e);
}

// Hook SharedPreferences to see if EQ is stored locally
try {
    const SharedPreferences = Java.use("android.content.SharedPreferences");
    const Editor = Java.use("android.content.SharedPreferences$Editor");

    Editor.putString.implementation = function(key, value) {
        if (key && (key.toLowerCase().includes("eq") || key.toLowerCase().includes("peq"))) {
            console.log(`\n[*] 💾 SharedPreferences SAVE: ${key} = ${value}`);
        }
        return this.putString(key, value);
    };

    SharedPreferences.getString.implementation = function(key, defValue) {
        const result = this.getString(key, defValue);
        if (key && (key.toLowerCase().includes("eq") || key.toLowerCase().includes("peq"))) {
            console.log(`\n[*] 💾 SharedPreferences READ: ${key} = ${result}`);
        }
        return result;
    };

    console.log("[*] ✅ SharedPreferences hooks installed");
} catch (e) {
    console.log("[!] Could not hook SharedPreferences:", e);
}

console.log("\n[*] ✅ Monitoring started!");
console.log("[*] Instructions:");
console.log("[*]   1. Connect to Earfun Tune Pro in the app");
console.log("[*]   2. Go to EQ settings");
console.log("[*]   3. Watch for any commands sent/received");
console.log("[*]   4. Look for GET commands (opcode != 0x95)");
console.log("");
