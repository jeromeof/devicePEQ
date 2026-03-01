# Ecoute TH1 Headphones - Bluetooth Protocol Guide

## Overview
This guide documents the complete Bluetooth Low Energy (BLE) protocol for connecting to and controlling the Ecoute TH1 headphones, including reading/writing 8-band EQ profiles.

---

## 1. BLUETOOTH CONNECTION

### 1.1 Service and Characteristic UUIDs

**Primary Service UUID:**
```
0000ff77-0000-1000-8000-00805f9b34fb
```

**Write Characteristic (Commands):**
```
0000ff88-0000-1000-8000-00805f9b34fb
Properties: WRITE (write-only)
```

**Notify Characteristic (Responses):**
```
0000ff99-0000-1000-8000-00805f9b34fb
Properties: NOTIFY
Client Config Descriptor: 00002902-0000-1000-8000-00805f9b34fb
```

### 1.2 Connection Flow

1. **Scan** for BLE devices advertising the service
2. **Connect** to the device's GATT server
3. **Request MTU** of 255 bytes (for larger data transfers)
4. **Discover Services** automatically after MTU negotiation
5. **Find Service** `0000ff77`
6. **Get Characteristics:**
   - Write: `0000ff88`
   - Notify: `0000ff99`
7. **Enable Notifications** on `0000ff99` by writing `0x01, 0x00` to descriptor `00002902`
8. **Ready** to send commands

### 1.3 Connection Parameters
- **MTU Size:** 255 bytes (requested via `requestMtu(255)`)
- **PHY:** 2M PHY (if supported, for faster communication)
- **Timeout:** 10 seconds for connection establishment

---

## 2. EQ PROFILE STRUCTURE

### 2.1 8-Band EQ Frequencies

The headphones support 8 frequency bands (in Hz):
```javascript
const EQ_FREQUENCIES = [30, 100, 200, 500, 900, 5000, 10000, 15000];
```

**Note:** The Ecoute TH1 device uses exactly 8 bands. The packet contains only 16 bytes of EQ data (8 bands × 2 bytes each), not 32 bytes.

### 2.2 Gain Values

- **Format:** Float values in dB
- **Typical Range:** -12.0 dB to +12.0 dB
- **Encoding:** Multiplied by 100 and stored as signed 16-bit integers
  - Example: 3.5 dB → 350 → `0x01 0x5E` (high byte, low byte)
  - Example: -6.0 dB → -600 → `0xFD 0xA8`

### 2.3 Preset Profiles

**Adjustment Curves (8 types):**
```javascript
const ADJUSTMENT_CURVES = {
  ECOUTE: 0,      // Balanced/reference
  HARMON: 1,      // Harmonic enhancement
  BASS_DCE: 2,    // Bass reduction
  TREBLE_DCE: 3,  // Treble reduction
  BASS_ADD: 4,    // Bass boost
  MIDRANGE: 5,    // Midrange emphasis
  TREBLE_ADD: 6,  // Treble boost
  FLAT: 7         // Flat response (all 0.0 dB)
};
```

**Genre Presets (7 types):**
```javascript
const GENRE_PRESETS = {
  ACOUSTIC: 0,
  CLASSICAL: 1,
  ELECTRONIC: 2,
  JAZZ: 3,
  RB: 4,
  ROCK: 5,
  SPOKEN: 6
};
```

**Example Preset Values:**
- **FLAT:** `[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]`
- **BASS BOOST:** `[6.0, 5.0, 4.0, 2.0, 0.0, 0.0, 0.0, 0.0]`
- **TREBLE:** `[0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 4.0, 6.0]`
- **V-SHAPE:** `[6.0, 4.0, 2.0, -2.0, -2.0, 0.0, 2.0, 4.0]`
- **VOCAL:** `[0.0, -2.0, -3.0, 4.0, 4.0, 3.0, 0.0, 0.0]`
- **ACOUSTIC:** `[3.8, 3.6, 2.8, -0.48, 2.88, -2.15, -6.0, 0.0]`
- **ROCK:** `[4.5, 3.0, 0.0, 0.0, 1.0, 3.0, 4.0, 4.0]`

---

## 3. COMMAND PROTOCOL

### 3.1 Packet Structure

All commands follow this format:
```
[HEADER] + [DATA] + [CRC]
```

**Header Format:**
```
Byte 0: 0xFE (254 decimal) - Start marker
Byte 1: 0x08 - Command type base
Byte 2: 0x00 - Reserved
Byte 3: 0x00 - Reserved
Byte 4: Data length (0x00, 0x01, or 0x11)
Byte 5: Command byte (varies by operation)
```

### 3.2 CRC Calculation

The protocol uses a **custom 16-bit CRC** (not CRC32):

```javascript
function calculateCRC(data, length) {
  let crc = 0xFFFF;

  for (let i = 0; i < length; i++) {
    crc = ((crc << 8) | (crc >> 8)) & 0xFFFF;
    crc ^= (data[i] & 0xFF);
    crc ^= ((crc & 0xFF) >> 4) & 0xFFFF;
    crc ^= (crc << 12) & 0xFFFF;
    crc ^= ((crc & 0xFF) << 5) & 0xFFFF;
  }

  return new Uint8Array([
    (crc >> 8) & 0xFF,  // High byte
    crc & 0xFF          // Low byte
  ]);
}
```

**Java Implementation (from source):**
```java
public static byte[] h(byte[] bArr, int i5) {
    int i6 = 0;
    byte b5 = 65535;
    while (i6 < bArr.length && i6 < i5) {
        byte b6 = (((b5 << 8) | (b5 >> 8)) & 65535) ^ (bArr[i6] & 255);
        byte b7 = b6 ^ (((b6 & 255) >> 4) & 65535);
        byte b8 = b7 ^ ((b7 << 12) & 65535);
        b5 = b8 ^ (((b8 & 255) << 5) & 65535);
        i6++;
    }
    return new byte[]{(byte) (b5 >> 8), (byte) b5};
}
```

### 3.3 Query Device State

**Command:** Request current EQ status
```javascript
const queryCommand = new Uint8Array([0xFE, 0x08, 0x00, 0x00, 0x00]);
const crc = calculateCRC(queryCommand, 5);
const fullCommand = new Uint8Array([...queryCommand, ...crc]);
// Result: [0xFE, 0x08, 0x00, 0x00, 0x00, CRC_HIGH, CRC_LOW]
```

### 3.4 Write EQ Profile

**Small Update (single adjustment):**
```javascript
function createSmallEQCommand(commandByte) {
  const header = new Uint8Array([0xFE, 0x08, 0x00, 0x00, 0x01, commandByte]);
  const crc = calculateCRC(header, header.length);
  return new Uint8Array([...header, ...crc]);
}
```

**Full 8-Band EQ Update:**
```javascript
function create8BandEQCommand(gainValues) {
  // gainValues: array of 8 floats in dB (e.g., [0, 3.5, -2.0, ...])

  // Header with 0x11 (17 decimal) and 0x65 (EQ command byte)
  const header = new Uint8Array([0xFE, 0x08, 0x00, 0x00, 0x11, 0x65]);

  // Encode 8 bands (16 bytes total: 8 bands × 2 bytes each)
  const encodedData = new Uint8Array(16); // 8 bands × 2 bytes

  for (let i = 0; i < 8; i++) {
    const gainDB = gainValues[i];
    let value = Math.round(gainDB * 100); // Convert to integer

    // Handle negative values for signed 16-bit
    if (value < 0) {
      value = 0x10000 + value; // Convert to unsigned representation
    }

    // Store as 16-bit signed integer (big-endian)
    encodedData[i * 2] = (value >> 8) & 0xFF;     // High byte
    encodedData[i * 2 + 1] = value & 0xFF;        // Low byte
  }

  // Combine header + data
  const packet = new Uint8Array([...header, ...encodedData]);

  // Calculate and append CRC
  const crc = calculateCRC(packet, packet.length);
  return new Uint8Array([...packet, ...crc]);
}

// Example usage:
const myEQ = [0, 3.5, 4.4, 2.0, 1.5, 0, -1.0, -2.0]; // 8 bands
const command = create8BandEQCommand(myEQ);
// Total packet size: 6 (header) + 16 (data) + 2 (CRC) = 24 bytes
// Send this to write characteristic 0000ff88
```

**Command Byte Values:**
- `0x65` (101 decimal): Full 16-band EQ update
- `0x0B` (11 decimal): Query device state

### 3.5 Write Queue Management

**Important:** BLE GATT operations must be sequential. Use a queue system:
1. Create a request queue (FIFO)
2. Send one write command at a time
3. Wait for `onCharacteristicWrite` callback
4. Process next command in queue
5. Timeout: 2 seconds per operation

---

## 4. IMPLEMENTATION EXAMPLES

### 4.1 Chrome Web Bluetooth API

```javascript
class EcouteTH1Controller {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
  }

  // Connect to headphones
  async connect() {
    try {
      // Request device
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ['0000ff77-0000-1000-8000-00805f9b34fb'] }
        ],
        optionalServices: ['0000ff77-0000-1000-8000-00805f9b34fb']
      });

      console.log('Connecting to', this.device.name);

      // Connect to GATT server
      this.server = await this.device.gatt.connect();
      console.log('Connected to GATT server');

      // Get service
      this.service = await this.server.getPrimaryService(
        '0000ff77-0000-1000-8000-00805f9b34fb'
      );
      console.log('Got service');

      // Get characteristics
      this.writeCharacteristic = await this.service.getCharacteristic(
        '0000ff88-0000-1000-8000-00805f9b34fb'
      );

      this.notifyCharacteristic = await this.service.getCharacteristic(
        '0000ff99-0000-1000-8000-00805f9b34fb'
      );

      // Enable notifications
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener(
        'characteristicvaluechanged',
        this.handleNotification.bind(this)
      );

      console.log('Setup complete!');
      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      return false;
    }
  }

  // Handle notifications from device
  handleNotification(event) {
    const value = event.target.value;
    const data = new Uint8Array(value.buffer);
    console.log('Received notification:', Array.from(data));
  }

  // Calculate CRC
  calculateCRC(data, length) {
    let crc = 0xFFFF;

    for (let i = 0; i < length; i++) {
      crc = ((crc << 8) | (crc >> 8)) & 0xFFFF;
      crc ^= (data[i] & 0xFF);
      crc ^= ((crc & 0xFF) >> 4) & 0xFFFF;
      crc ^= (crc << 12) & 0xFFFF;
      crc ^= ((crc & 0xFF) << 5) & 0xFFFF;
    }

    return new Uint8Array([
      (crc >> 8) & 0xFF,
      crc & 0xFF
    ]);
  }

  // Query current device state
  async queryDevice() {
    const command = new Uint8Array([0xFE, 0x08, 0x00, 0x00, 0x00]);
    const crc = this.calculateCRC(command, 5);
    const fullCommand = new Uint8Array([...command, ...crc]);

    await this.writeCharacteristic.writeValue(fullCommand);
    console.log('Query sent');
  }

  // Write 8-band EQ profile
  async writeEQProfile(gainValues) {
    if (gainValues.length !== 8) {
      throw new Error('Must provide exactly 8 gain values');
    }

    // Header
    const header = new Uint8Array([0xFE, 0x08, 0x00, 0x00, 0x11, 0x65]);

    // Encode gain values (8 bands × 2 bytes = 16 bytes)
    const encodedData = new Uint8Array(16);

    for (let i = 0; i < 8; i++) {
      const gainDB = gainValues[i];
      let value = Math.round(gainDB * 100);

      // Handle negative values for signed 16-bit
      if (value < 0) {
        value = 0x10000 + value;
      }

      encodedData[i * 2] = (value >> 8) & 0xFF;
      encodedData[i * 2 + 1] = value & 0xFF;
    }

    // Combine
    const packet = new Uint8Array([...header, ...encodedData]);

    // Add CRC
    const crc = this.calculateCRC(packet, packet.length);
    const fullCommand = new Uint8Array([...packet, ...crc]);

    await this.writeCharacteristic.writeValue(fullCommand);
    console.log('EQ profile written:', gainValues);
  }

  // Disconnect
  async disconnect() {
    if (this.device && this.device.gatt.connected) {
      await this.device.gatt.disconnect();
      console.log('Disconnected');
    }
  }
}

// Usage example:
const controller = new EcouteTH1Controller();

// HTML button handlers
document.getElementById('connectBtn').addEventListener('click', async () => {
  await controller.connect();
});

document.getElementById('queryBtn').addEventListener('click', async () => {
  await controller.queryDevice();
});

document.getElementById('setEQBtn').addEventListener('click', async () => {
  // Example: Bass boost profile (8 bands)
  const bassBoost = [6.0, 5.0, 4.0, 2.0, 0.0, 0.0, 0.0, 0.0];
  await controller.writeEQProfile(bassBoost);
});
```

### 4.2 Android Native Implementation

```kotlin
class EcouteTH1Manager(private val context: Context) {
    private val bluetoothAdapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private var bluetoothGatt: BluetoothGatt? = null
    private var writeCharacteristic: BluetoothGattCharacteristic? = null
    private var notifyCharacteristic: BluetoothGattCharacteristic? = null

    private val SERVICE_UUID = UUID.fromString("0000ff77-0000-1000-8000-00805f9b34fb")
    private val WRITE_UUID = UUID.fromString("0000ff88-0000-1000-8000-00805f9b34fb")
    private val NOTIFY_UUID = UUID.fromString("0000ff99-0000-1000-8000-00805f9b34fb")
    private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.d(TAG, "Connected")
                    gatt.requestMtu(255)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "Disconnected")
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            Log.d(TAG, "MTU changed to $mtu")
            gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                val service = gatt.getService(SERVICE_UUID)
                writeCharacteristic = service?.getCharacteristic(WRITE_UUID)
                notifyCharacteristic = service?.getCharacteristic(NOTIFY_UUID)

                // Enable notifications
                gatt.setCharacteristicNotification(notifyCharacteristic, true)
                val descriptor = notifyCharacteristic?.getDescriptor(CCCD_UUID)
                descriptor?.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(descriptor)

                Log.d(TAG, "Services discovered and notifications enabled")
            }
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            val data = characteristic.value
            Log.d(TAG, "Notification received: ${data.joinToString()}")
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            Log.d(TAG, "Write complete: $status")
        }
    }

    fun connect(device: BluetoothDevice) {
        bluetoothGatt = device.connectGatt(context, false, gattCallback)
    }

    fun calculateCRC(data: ByteArray, length: Int): ByteArray {
        var crc = 0xFFFF

        for (i in 0 until length) {
            crc = ((crc shl 8) or (crc shr 8)) and 0xFFFF
            crc = crc xor (data[i].toInt() and 0xFF)
            crc = crc xor (((crc and 0xFF) shr 4) and 0xFFFF)
            crc = crc xor ((crc shl 12) and 0xFFFF)
            crc = crc xor (((crc and 0xFF) shl 5) and 0xFFFF)
        }

        return byteArrayOf(
            ((crc shr 8) and 0xFF).toByte(),
            (crc and 0xFF).toByte()
        )
    }

    fun writeEQProfile(gainValues: FloatArray) {
        require(gainValues.size == 8) { "Must provide 8 gain values" }

        // Header
        val header = byteArrayOf(0xFE.toByte(), 0x08, 0x00, 0x00, 0x11, 0x65)

        // Encode gains (8 bands × 2 bytes = 16 bytes)
        val encodedData = ByteArray(16)
        for (i in 0 until 8) {
            val gainDB = gainValues[i]
            var value = (gainDB * 100).toInt()

            // Handle negative values
            if (value < 0) {
                value = 0x10000 + value
            }

            encodedData[i * 2] = ((value shr 8) and 0xFF).toByte()
            encodedData[i * 2 + 1] = (value and 0xFF).toByte()
        }

        // Combine
        val packet = header + encodedData
        val crc = calculateCRC(packet, packet.size)
        val fullCommand = packet + crc

        // Write
        writeCharacteristic?.value = fullCommand
        bluetoothGatt?.writeCharacteristic(writeCharacteristic)
    }

    companion object {
        private const val TAG = "EcouteTH1"
    }
}
```

---

## 5. IMPORTANT NOTES

### 5.1 Permissions Required

**Android:**
- `BLUETOOTH_SCAN`
- `BLUETOOTH_CONNECT`
- `ACCESS_FINE_LOCATION` (for BLE scanning on Android < 12)

**Web Bluetooth:**
- HTTPS required (or localhost for development)
- User gesture required to trigger `requestDevice()`

### 5.2 Device Identification

When scanning, look for:
- **Service UUID:** `0000ff77-0000-1000-8000-00805f9b34fb` in advertisement
- **Device Name:** May contain "Ecoute" or "TH1"

### 5.3 Gain Value Limits

Based on the preset profiles, safe ranges are:
- **Minimum:** -12.0 dB
- **Maximum:** +12.0 dB
- Values outside this range may be clamped by the device

### 5.4 Data Persistence

The app stores:
- Last connected device MAC in SharedPreferences: `"last_ble_device_mac"`
- EQ profiles per device using device MAC hash
- Checked/default states: `"eq_group_checked" + mac.hashCode()`

---

## 6. TROUBLESHOOTING

### Connection Issues
- Ensure Bluetooth is enabled
- Check location services are on (Android)
- Verify permissions granted
- Try increasing MTU timeout

### Write Failures
- Check CRC calculation is correct
- Ensure sequential writes (use queue)
- Wait for write callback before next command
- Verify characteristic has WRITE property

### No Response from Device
- Check notifications are enabled on `0000ff99`
- Verify CCCD descriptor is set to `0x01 0x00`
- Look for responses in notification handler

---

## 7. TESTING COMMANDS

### Test Sequence

1. **Connect and query:**
```javascript
await controller.connect();
await controller.queryDevice();
```

2. **Set flat EQ (all zeros):**
```javascript
const flat = [0, 0, 0, 0, 0, 0, 0, 0];
await controller.writeEQProfile(flat);
```

3. **Set bass boost:**
```javascript
const bassBoost = [6.0, 5.0, 4.0, 2.0, 0, 0, 0, 0];
await controller.writeEQProfile(bassBoost);
```

4. **Set V-shape (smile curve):**
```javascript
const vShape = [6, 4, 2, -2, -2, 0, 2, 4];
await controller.writeEQProfile(vShape);
```

---

## SUMMARY

**Key UUIDs:**
- Service: `0000ff77-0000-1000-8000-00805f9b34fb`
- Write: `0000ff88-0000-1000-8000-00805f9b34fb`
- Notify: `0000ff99-0000-1000-8000-00805f9b34fb`

**EQ Frequencies (8 bands):**
`30Hz, 100Hz, 200Hz, 500Hz, 900Hz, 5kHz, 10kHz, 15kHz`

**Packet Format:**
`[0xFE, 0x08, 0x00, 0x00, LENGTH, CMD] + [DATA] + [CRC]`

**EQ Command:**
`0x65` for 8-band EQ update

**Packet Size:**
- Header: 6 bytes
- EQ Data: 16 bytes (8 bands × 2 bytes each)
- CRC: 2 bytes
- **Total: 24 bytes**

**Acknowledgment Response:**
`[0xFE, 0x08, 0x02, 0x00, 0x00, 0x0A, 0x51]` - Standard success acknowledgment (7 bytes)
