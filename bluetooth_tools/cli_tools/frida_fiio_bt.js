/**
 * FiiO Bluetooth Protocol Capture
 *
 * Captures and decodes FiiO Control app (com.fiio.control) BLE/SPP traffic.
 * The app is Flutter-based; BT calls go through native Android APIs.
 *
 * Known FiiO packet format (same as USB HID, without the HID reportId prefix):
 *
 *   TX  host → device:  AA 0A 00 00 [CMD] [LEN] [DATA...] 00 EE
 *   RX  device → host:  BB 0B 00 00 [CMD] [LEN] [DATA...] 00 EE
 *
 * PEQ commands:
 *   0x15  PEQ_FILTER_PARAMS   get/set one biquad band
 *   0x16  PEQ_PRESET_SWITCH   get/set active slot (0-based)
 *   0x17  PEQ_GLOBAL_GAIN     get/set preamp gain (×10, signed 16-bit LE)
 *   0x18  PEQ_FILTER_COUNT    get/set number of active bands
 *   0x19  PEQ_SAVE_TO_DEVICE  save slot to flash
 *   0x1B  PEQ_RESET_DEVICE    factory reset single band
 *   0x1C  PEQ_RESET_ALL       factory reset all
 *   0x0B  FIRMWARE_VERSION    (different header style)
 *   0x30  DEVICE_NAME         (different header style)
 *
 * SET filter params (TX, len=8):
 *   AA 0A 00 00 15 08 [idx] [gainL] [gainH] [freqL] [freqH] [qL] [qH] [type] 00 EE
 *
 * GET filter params response (RX):
 *   BB 0B 00 00 15 [len] [idx] [gainL] [gainH] [freqL] [freqH] [qL] [qH] [type] ...
 *
 * Gain encoding: signed 16-bit big-endian, value/10 = dB
 * Freq encoding: unsigned 16-bit big-endian, direct Hz
 * Q encoding:    unsigned 16-bit big-endian, value/100 = Q
 * Filter types:  0=PK (Peaking), 1=LSQ (Low Shelf), 2=HSQ (High Shelf)
 */

// ── console relay so Python output file also gets all messages ───────────────
const _origLog = console.log;
console.log = function(...args) {
    const msg = args.join(' ');
    _origLog.apply(console, args);
    try { send({ type: 'log', message: msg }); } catch (_) {}
};

console.log('🎧 FiiO BT Protocol Capture v1.0');
console.log('Packet format: AA 0A (TX) / BB 0B (RX)');
console.log('');

// ── constants matching fiioUsbHidHandler.js ──────────────────────────────────
const TX_HDR1 = 0xAA, TX_HDR2 = 0x0A;   // host → device
const RX_HDR1 = 0xBB, RX_HDR2 = 0x0B;   // device → host (also used as GET query)
const END_MARKER = 0xEE;

const CMD_NAMES = {
    0x0B: 'FIRMWARE_VERSION',
    0x15: 'PEQ_FILTER_PARAMS',
    0x16: 'PEQ_PRESET_SWITCH',
    0x17: 'PEQ_GLOBAL_GAIN',
    0x18: 'PEQ_FILTER_COUNT',
    0x19: 'PEQ_SAVE_TO_DEVICE',
    0x1B: 'PEQ_RESET_DEVICE',
    0x1C: 'PEQ_RESET_ALL',
    0x30: 'DEVICE_NAME',
};

const FILTER_TYPE_NAMES = { 0: 'PK (Peaking)', 1: 'LSQ (Low Shelf)', 2: 'HSQ (High Shelf)' };

// ── helpers ──────────────────────────────────────────────────────────────────
function toHex(bytes) {
    return Array.prototype.slice.call(bytes).map(b => ('0' + (b & 0xFF).toString(16).toUpperCase()).slice(-2)).join(' ');
}

function u16be(lo, hi) { return ((lo & 0xFF) << 8) | (hi & 0xFF); }

function decodeGain(lo, hi) {
    let r = u16be(lo, hi);
    return (r & 0x8000) ? -((r ^ 0xFFFF) + 1) / 10 : r / 10;
}

function isFiioPkt(arr) {
    if (arr.length < 4) return false;
    return (arr[0] === TX_HDR1 && arr[1] === TX_HDR2) ||
           (arr[0] === RX_HDR1 && arr[1] === RX_HDR2);
}

function parseFiioPkt(arr, direction) {
    const h1 = arr[0], h2 = arr[1];
    const cmd = arr.length > 4 ? arr[4] : 0;
    const len = arr.length > 5 ? arr[5] : 0;
    const cmdName = CMD_NAMES[cmd] || ('0x' + cmd.toString(16).toUpperCase());
    const isQuery = (h1 === RX_HDR1);   // BB 0B used for GET queries too
    const isTx    = (h1 === TX_HDR1);

    console.log('   ┌─ FiiO Protocol ──────────────────────┐');
    console.log('   │ Header:  ' + (isTx ? 'AA 0A (TX host→device)' : 'BB 0B (RX device→host / GET query)'));
    console.log('   │ Command: 0x' + cmd.toString(16).toUpperCase().padStart(2, '0') + ' = ' + cmdName);
    console.log('   │ DataLen: ' + len);

    if (arr.length <= 6) {
        console.log('   └──────────────────────────────────────┘');
        return;
    }

    const data = arr.slice(6);  // data bytes after header+cmd+len

    switch (cmd) {
        case 0x15: {   // PEQ_FILTER_PARAMS
            if (len === 0 && data.length >= 1) {
                // GET query: BB 0B 00 00 15 01 [filterIdx] 00 EE
                console.log('   │ Action:  GET filter #' + (data[0] & 0xFF));
            } else if (len >= 8 && data.length >= 8) {
                const idx      = data[0] & 0xFF;
                const gain     = decodeGain(data[1], data[2]);
                const freq     = u16be(data[3], data[4]);
                const q        = u16be(data[5], data[6]) / 100;
                const ftype    = FILTER_TYPE_NAMES[data[7] & 0xFF] || ('0x' + (data[7]).toString(16));
                console.log('   │ Filter:  #' + idx);
                console.log('   │ Freq:    ' + freq + ' Hz');
                console.log('   │ Gain:    ' + gain.toFixed(1) + ' dB');
                console.log('   │ Q:       ' + q.toFixed(2));
                console.log('   │ Type:    ' + ftype);
            } else {
                console.log('   │ Data:    ' + toHex(data));
            }
            break;
        }
        case 0x16: {   // PEQ_PRESET_SWITCH
            if (len === 0) {
                console.log('   │ Action:  GET current preset');
            } else if (data.length >= 1) {
                console.log('   │ Preset:  ' + (data[0] & 0xFF));
            }
            break;
        }
        case 0x17: {   // PEQ_GLOBAL_GAIN
            if (len === 0) {
                console.log('   │ Action:  GET global gain');
            } else if (data.length >= 2) {
                const gain = decodeGain(data[0], data[1]);
                console.log('   │ GlobalGain: ' + gain.toFixed(1) + ' dB');
            }
            break;
        }
        case 0x18: {   // PEQ_FILTER_COUNT
            if (len === 0) {
                console.log('   │ Action:  GET filter count');
            } else if (data.length >= 1) {
                console.log('   │ Count:   ' + (data[0] & 0xFF) + ' active bands');
            }
            break;
        }
        case 0x19: {   // PEQ_SAVE_TO_DEVICE
            if (data.length >= 1) {
                console.log('   │ Action:  SAVE to slot ' + (data[0] & 0xFF));
            }
            break;
        }
        case 0x1B: { console.log('   │ Action:  RESET device'); break; }
        case 0x1C: { console.log('   │ Action:  RESET all'); break; }
        default:
            console.log('   │ Data:    ' + toHex(data));
    }

    // Check for EE end-marker
    if (arr[arr.length - 1] === END_MARKER) {
        console.log('   │ EndMark: EE ✓');
    } else {
        console.log('   │ EndMark: missing (fragmented?)');
    }

    console.log('   └──────────────────────────────────────┘');
}

// ── main hook installation ───────────────────────────────────────────────────
Java.perform(function () {
    console.log('📱 Installing FiiO BT hooks...');

    // ── 1. SPP Classic Bluetooth ─────────────────────────────────────────────
    try {
        const OutputStream = Java.use('java.io.OutputStream');
        OutputStream.write.overload('[B').implementation = function (bytes) {
            const arr = Array.prototype.slice.call(bytes);
            console.log('\n' + '─'.repeat(70));
            console.log('📤 SPP TX  len=' + arr.length + '  ' + toHex(arr));
            if (isFiioPkt(arr)) parseFiioPkt(arr, 'TX');
            console.log('─'.repeat(70));
            return this.write(bytes);
        };

        const InputStream = Java.use('java.io.InputStream');
        InputStream.read.overload('[B').implementation = function (buf) {
            const n = this.read(buf);
            if (n > 0) {
                const arr = Array.prototype.slice.call(buf, 0, n);
                console.log('\n' + '─'.repeat(70));
                console.log('📥 SPP RX  len=' + n + '  ' + toHex(arr));
                if (isFiioPkt(arr)) parseFiioPkt(arr, 'RX');
                console.log('─'.repeat(70));
            }
            return n;
        };
        console.log('✅ SPP hooks installed');
    } catch (e) {
        console.log('⚠️  SPP hooks failed: ' + e.message);
    }

    // ── 2. BLE GATT write (host → device) ────────────────────────────────────
    try {
        const BluetoothGatt = Java.use('android.bluetooth.BluetoothGatt');
        BluetoothGatt.writeCharacteristic
            .overload('android.bluetooth.BluetoothGattCharacteristic')
            .implementation = function (char) {
                const uuid = char.getUuid().toString();
                const value = char.getValue();
                if (value && value.length > 0) {
                    const arr = Array.prototype.slice.call(value);
                    console.log('\n' + '═'.repeat(70));
                    console.log('📤 BLE TX  uuid=' + uuid);
                    console.log('   hex=' + toHex(arr));
                    if (isFiioPkt(arr)) parseFiioPkt(arr, 'TX');
                    console.log('═'.repeat(70));
                }
                return this.writeCharacteristic(char);
            };
        console.log('✅ BLE write hook installed');
    } catch (e) {
        console.log('⚠️  BLE write hook failed: ' + e.message);
    }

    // ── 3. BLE GATT notification / read callbacks (device → host) ────────────
    // Hook the abstract base class – Frida will intercept all subclass calls.
    try {
        const GattCB = Java.use('android.bluetooth.BluetoothGattCallback');

        GattCB.onCharacteristicChanged
            .overload('android.bluetooth.BluetoothGatt', 'android.bluetooth.BluetoothGattCharacteristic')
            .implementation = function (gatt, char) {
                const uuid  = char.getUuid().toString();
                const value = char.getValue();
                if (value && value.length > 0) {
                    const arr = Array.prototype.slice.call(value);
                    console.log('\n' + '═'.repeat(70));
                    console.log('📥 BLE NOTIFY  uuid=' + uuid);
                    console.log('   hex=' + toHex(arr));
                    if (isFiioPkt(arr)) parseFiioPkt(arr, 'RX');
                    console.log('═'.repeat(70));
                }
                return this.onCharacteristicChanged(gatt, char);
            };

        GattCB.onCharacteristicRead
            .overload('android.bluetooth.BluetoothGatt',
                      'android.bluetooth.BluetoothGattCharacteristic',
                      'int')
            .implementation = function (gatt, char, status) {
                const uuid  = char.getUuid().toString();
                const value = char.getValue();
                if (value && value.length > 0) {
                    const arr = Array.prototype.slice.call(value);
                    console.log('\n' + '═'.repeat(70));
                    console.log('📥 BLE READ RESP  uuid=' + uuid + '  status=' + status);
                    console.log('   hex=' + toHex(arr));
                    if (isFiioPkt(arr)) parseFiioPkt(arr, 'RX');
                    console.log('═'.repeat(70));
                }
                return this.onCharacteristicRead(gatt, char, status);
            };

        GattCB.onConnectionStateChange
            .overload('android.bluetooth.BluetoothGatt', 'int', 'int')
            .implementation = function (gatt, status, newState) {
                const dev = gatt.getDevice();
                console.log('\n⚡ BLE state change  device=' + dev.getAddress() +
                            ' (' + dev.getName() + ')  status=' + status +
                            '  newState=' + newState +
                            (newState === 2 ? ' [CONNECTED]' : newState === 0 ? ' [DISCONNECTED]' : ''));
                return this.onConnectionStateChange(gatt, status, newState);
            };

        GattCB.onServicesDiscovered
            .overload('android.bluetooth.BluetoothGatt', 'int')
            .implementation = function (gatt, status) {
                console.log('\n🔍 BLE services discovered  status=' + status);
                try {
                    const services = gatt.getServices();
                    const iter = services.iterator();
                    while (iter.hasNext()) {
                        const svc = iter.next();
                        console.log('   Service: ' + svc.getUuid());
                        const chars = svc.getCharacteristics();
                        const citer = chars.iterator();
                        while (citer.hasNext()) {
                            const c = citer.next();
                            const props = c.getProperties();
                            const flags = [];
                            if (props & 0x02) flags.push('READ');
                            if (props & 0x04) flags.push('WRITE_NR');
                            if (props & 0x08) flags.push('WRITE');
                            if (props & 0x10) flags.push('NOTIFY');
                            if (props & 0x20) flags.push('INDICATE');
                            console.log('     Char: ' + c.getUuid() + '  [' + flags.join('|') + ']');
                        }
                    }
                } catch (e2) {
                    console.log('   (could not enumerate services: ' + e2.message + ')');
                }
                return this.onServicesDiscovered(gatt, status);
            };

        console.log('✅ BLE callback hooks installed');
    } catch (e) {
        console.log('⚠️  BLE callback hooks failed: ' + e.message);
    }

    // ── 4. Flutter MethodChannel (high-level insight) ─────────────────────────
    try {
        const MC = Java.use('io.flutter.plugin.common.MethodChannel');
        MC.invokeMethod.overload('java.lang.String', 'java.lang.Object')
            .implementation = function (method, args) {
                // Only log potentially interesting calls
                const m = method.toLowerCase();
                if (m.includes('eq') || m.includes('peq') || m.includes('filter') ||
                    m.includes('preset') || m.includes('gain') || m.includes('audio') ||
                    m.includes('ble') || m.includes('bt') || m.includes('connect') ||
                    m.includes('device') || m.includes('write') || m.includes('send')) {
                    console.log('\n🎨 Flutter→Native  method=' + method);
                    if (args) {
                        try { console.log('   args=' + JSON.stringify(args)); } catch (_) {
                            console.log('   args=' + args.toString());
                        }
                    }
                }
                return this.invokeMethod(method, args);
            };
        console.log('✅ Flutter MethodChannel hook installed');
    } catch (e) {
        console.log('⚠️  Flutter hook failed: ' + e.message);
    }

    console.log('\n✅ All hooks active.  Interact with EQ in FiiO Control now.\n');
    console.log('💡 Tips:');
    console.log('   1. Open FiiO Control → EQ section');
    console.log('   2. Change a band frequency/gain/Q');
    console.log('   3. Switch between presets');
    console.log('   4. Note the "AA 0A" TX and "BB 0B" RX lines above\n');
});
