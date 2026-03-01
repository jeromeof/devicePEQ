# Audio EQ, Bass, and Treble Documentation

## Overview

This document describes the implementation of audio equalization (EQ), bass, and treble controls in the UGREEN Connect Android application. The system communicates with Bluetooth audio devices using the JieLi RCSP (Remote Control Serial Protocol).

## Table of Contents

1. [Bass and Treble System](#bass-and-treble-system)
2. [Equalizer (EQ) System](#equalizer-eq-system)
3. [Protocol Details](#protocol-details)
4. [Key Findings and Limitations](#key-findings-and-limitations)

---

## Bass and Treble System

### Architecture

Bass and treble controls are handled separately from the EQ system using AttrBean type `11` in the public system info category.

### Implementation Files

- **Command Builder**: `com/jieli/jl_rcsp/util/CommandBuilder.java`
- **Data Handler**: `com/jieli/jl_rcsp/tool/RcspDataHandler.java`
- **Event Listener Interface**: `com/jieli/jl_rcsp/interfaces/rcsp/OnRcspEventListener.java`
- **Event Manager**: `com/jieli/jl_rcsp/tool/callback/RcspEventListenerManager.java`

### Setting Bass and Treble

**Location**: `CommandBuilder.java:591-602`

```java
public static CommandBase buildSetHighAndBassCmd(int i, int i4) {
    ArrayList arrayList = new ArrayList();
    AttrBean attrBean = new AttrBean();
    attrBean.setType((byte) 11);
    byte[] bArr = new byte[8];
    byte[] intToBigBytes = CHexConver.intToBigBytes(i);
    System.arraycopy(CHexConver.intToBigBytes(i4), 0, bArr, 0, 4);
    System.arraycopy(intToBigBytes, 0, bArr, 4, 4);
    attrBean.setAttrData(bArr);
    arrayList.add(attrBean);
    return buildSetSysInfoCmd((byte) -1, arrayList);
}
```

**Data Structure**:
- Total: 8 bytes
- Bytes 0-3: First parameter (likely bass) - 4-byte big-endian integer
- Bytes 4-7: Second parameter (likely treble) - 4-byte big-endian integer

**Note**: The parameter order suggests bass is first (i4), then treble (i), based on the copy operations.

### Getting Bass and Treble

**Location**: `CommandBuilder.java:347-349`

```java
public static CommandBase buildGetHighAndBassCmd() {
    return buildGetSysInfoCmd((byte) -1, DfuException.ERROR_CONNECTION_MASK);
}
```

The constant `ERROR_CONNECTION_MASK` value is used as the attribute mask for querying bass and treble settings.

### Reading Bass and Treble Response

**Location**: `RcspDataHandler.java:462-467`

```java
case 11:
    if (attrData.length < 8) {
        break;
    } else {
        this.f16860b.onHighAndBassChange(bluetoothDevice2,
            CHexConver.bytesToInt(attrData, 0, 4),
            CHexConver.bytesToInt(attrData, 4, 4));
        break;
    }
```

**Parsing Logic**:
1. Validates data length is at least 8 bytes
2. Extracts first 4 bytes as first parameter
3. Extracts second 4 bytes as second parameter
4. Triggers `onHighAndBassChange` callback with both values

### Event Callback

**Interface**: `OnRcspEventListener.java:87`

```java
public void onHighAndBassChange(BluetoothDevice bluetoothDevice, int i, int i4) {
}
```

---

## Equalizer (EQ) System

### Architecture

The EQ system supports two formats:
1. **Legacy Format**: Fixed 10-band EQ (deprecated)
2. **Dynamic Format**: Variable-band EQ with frequency specification

### Data Models

#### EqInfo Class

**Location**: `com/jieli/jl_rcsp/model/device/EqInfo.java`

```java
public class EqInfo {
    private int count = 10;              // Number of EQ bands
    private boolean dynamic;              // New format flag
    private int[] freqs;                  // Frequency values for each band (Hz)
    private int mode;                     // EQ preset mode
    private byte[] value = new byte[10]; // Gain values for each band
}
```

**Key Fields**:
- `mode`: EQ preset mode (0-127 when dynamic flag is set)
- `dynamic`: When true, uses new variable-band format
- `freqs[]`: Array of frequency values in Hz (e.g., [60, 150, 400, 1000, 2400, 6000, 12000, 15000])
- `value[]`: Gain values for each frequency band (signed byte values)

#### EqPresetInfo Class

**Location**: `com/jieli/jl_rcsp/model/device/EqPresetInfo.java`

```java
public class EqPresetInfo {
    private List<EqInfo> eqInfos;  // List of preset EQ configurations
    private int[] freqs;            // Frequency bands
    private int number;             // Number of frequency bands
}
```

### Setting EQ Values

#### Legacy Format (Deprecated)

**Location**: `CommandBuilder.java:551-563`

```java
@Deprecated
public static CommandBase buildSetEqValueCmd(byte b4, byte[] bArr) {
    AttrBean attrBean = new AttrBean();
    attrBean.setType((byte) 4);
    byte[] bArr2 = new byte[11];
    bArr2[0] = b4;  // EQ mode
    if (bArr != null && bArr.length == 10) {
        System.arraycopy(bArr, 0, bArr2, 1, bArr.length);
    }
    attrBean.setAttrData(bArr2);
    ArrayList arrayList = new ArrayList();
    arrayList.add(attrBean);
    return buildSetPublicSysInfoCmd(arrayList);
}
```

**Data Structure**:
- Byte 0: EQ mode
- Bytes 1-10: 10 gain values (one per fixed frequency band)

#### Dynamic Format (Current)

**Location**: `CommandBuilder.java:790-804`

```java
public static CommandBase buildSetEqValueCmd(boolean z9, byte b4, byte[] bArr) {
    if (!z9) {
        return buildSetEqValueCmd(b4, bArr);  // Falls back to legacy
    }
    AttrBean attrBean = new AttrBean();
    attrBean.setType((byte) 4);
    byte[] bArr2 = new byte[(bArr.length + 2)];
    bArr2[0] = (byte) (b4 | 128);  // Mode with dynamic flag (bit 7 set)
    bArr2[1] = (byte) bArr.length;  // Number of bands
    System.arraycopy(bArr, 0, bArr2, 2, bArr.length);
    attrBean.setAttrData(bArr2);
    ArrayList arrayList = new ArrayList();
    arrayList.add(attrBean);
    return buildSetPublicSysInfoCmd(arrayList);
}
```

**Data Structure**:
- Byte 0: EQ mode with bit 7 set (value | 0x80)
- Byte 1: Number of EQ bands
- Bytes 2+: Gain values for each band

### Getting EQ Values

**Location**: `CommandBuilder.java:311-313`

```java
public static CommandBase buildGetEqValueCmd() {
    return buildGetPublicSysInfoCmd(16);
}
```

### Getting EQ Preset Information

**Location**: `CommandBuilder.java:303-305` and `307-309`

```java
// Get both preset and current values
public static CommandBase buildGetEqPresetAndEqValueCmd() {
    return buildGetPublicSysInfoCmd(4112);
}

// Get only preset information
public static CommandBase buildGetEqPresetValueCmd() {
    return buildGetPublicSysInfoCmd(4096);
}
```

### Reading EQ Response

**Location**: `RcspDataHandler.java:367-401`

```java
case 4:  // EQ Data
    byte b4 = attrData[0];
    if ((b4 & 128) == 128) {
        z9 = true;  // Dynamic format
    } else {
        z9 = false;  // Legacy format
    }
    EqInfo eqInfo = new EqInfo();
    eqInfo.setMode(CHexConver.byteToInt(b4) & 127);  // Mask out dynamic flag
    eqInfo.setDynamic(z9);

    if (z9) {  // Dynamic format
        byte b7 = attrData[1];  // Number of bands
        byte[] bArr = new byte[b7];
        System.arraycopy(attrData, 2, bArr, 0, b7);
        eqInfo.setValue(bArr);
        // Get frequency information from preset data
        EqPresetInfo a3 = a(list);
        if (a3 == null) {
            a3 = deviceInfo.getEqPresetInfo();
        }
        if (a3 != null) {
            eqInfo.setFreqs(a3.getFreqs());
        }
    } else {  // Legacy format
        byte[] bArr2 = new byte[0];
        if (attrData.length > 10) {
            bArr2 = new byte[10];
            System.arraycopy(attrData, 1, bArr2, 0, 10);
        }
        eqInfo.setValue(bArr2);
    }
    deviceInfo.setEqInfo(eqInfo);
    this.f16860b.onEqChange(bluetoothDevice2, eqInfo);
    break;
```

### Reading EQ Preset Response

**Location**: `RcspDataHandler.java:1025-1049`

```java
public final EqPresetInfo a(AttrBean attrBean) {
    EqPresetInfo eqPresetInfo = new EqPresetInfo();
    byte[] attrData = attrBean.getAttrData();
    ArrayList arrayList = new ArrayList();
    byte b4 = attrData[0];  // Number of frequency bands
    int[] iArr = new int[b4];
    int i = 1;

    // Parse frequency values
    for (int i4 = 0; i4 < b4; i4++) {
        iArr[i4] = ((attrData[i] & 255) << 8) | (attrData[i + 1] & 255);
        i += 2;
    }

    // Parse 7 preset EQ configurations
    for (int i7 = 0; i7 < 7; i7++) {
        byte[] bArr = new byte[b4];
        System.arraycopy(attrData, i + 1, bArr, 0, b4);
        EqInfo eqInfo = new EqInfo((byte) (attrData[i] & Byte.MAX_VALUE), bArr, iArr);
        eqInfo.setDynamic((attrData[i] & 128) == 128);
        arrayList.add(eqInfo);
        i += b4 + 1;
    }

    eqPresetInfo.setNumber(b4);
    eqPresetInfo.setFreqs(iArr);
    eqPresetInfo.setEqInfos(arrayList);
    return eqPresetInfo;
}
```

**EQ Preset Data Structure**:
- Byte 0: Number of frequency bands (N)
- Bytes 1 to 2N: Frequency values (2 bytes each, big-endian)
- Followed by 7 preset configurations, each containing:
  - 1 byte: Mode (bit 7 = dynamic flag, bits 0-6 = mode value)
  - N bytes: Gain values for each frequency band

### Sound Card EQ

The system also supports a separate "Sound Card EQ" for audio interface devices:

**Get Sound Card EQ**: `CommandBuilder.java:375-377`
```java
public static CommandBase buildGetSoundCardEqInfo() {
    return buildGetPublicSysInfoCmd(393216);
}
```

**Set Sound Card EQ**: `CommandBuilder.java:631-641`
```java
public static CommandBase buildSetSoundCardEqValue(byte[] bArr) {
    AttrBean attrBean = new AttrBean();
    attrBean.setType((byte) 18);
    byte[] bArr2 = new byte[(bArr.length + 1)];
    bArr2[0] = (byte) bArr.length;
    System.arraycopy(bArr, 0, bArr2, 1, bArr.length);
    attrBean.setAttrData(bArr2);
    ArrayList arrayList = new ArrayList();
    arrayList.add(attrBean);
    return buildSetPublicSysInfoCmd(arrayList);
}
```

---

## Protocol Details

### AttrBean Types

The system uses different `AttrBean` type values to identify different audio parameters:

| Type | Description | Category |
|------|-------------|----------|
| 4 | EQ Values | Public System Info |
| 11 | Bass and Treble | Public System Info |
| 12 | EQ Preset Information | Public System Info |
| 17 | Sound Card EQ Frequencies | Public System Info |
| 18 | Sound Card EQ Values | Public System Info |

### System Info Categories

Commands are categorized by system info type (first parameter to `buildSetSysInfoCmd` or `buildGetSysInfoCmd`):

| Value | Category |
|-------|----------|
| -1 (0xFF) | Public System Info (includes EQ, bass/treble) |
| 0 | Bluetooth System Info |
| 1 | Music System Info |
| 2 | RTC/Alarm System Info |
| 3 | AUX System Info |
| 4 | FM Radio System Info |

### Data Parsing Flow

1. **Device → App**: Device sends system info update
2. **RcspDataHandler.parseAttrMessage()**: Routes to appropriate parser based on category
3. **RcspDataHandler.e()**: Parses public system info (EQ, bass/treble)
4. **Switch on AttrBean.type**: Handles specific attribute type
5. **Event callback**: Notifies listeners of changes

### Constants

**Default EQ Frequencies**: `RcspConstant.DEFAULT_EQ_FREQS`
- Used when frequency information is not provided by device

---

## Key Findings and Limitations

### What is NOT Supported

1. **No PEQ (Parametric EQ)**: The protocol does not support parametric equalizers
2. **No Q Values**: There is no support for Q factor/bandwidth control
3. **No Per-Band Filter Types**: Cannot specify filter type (peaking, shelf, notch, etc.)

### What IS Supported

1. **Graphic EQ**: Fixed or variable frequency bands with gain control
2. **EQ Presets**: Up to 7 preset EQ configurations
3. **Dynamic Band Count**: Modern format supports variable number of EQ bands
4. **Separate Bass/Treble**: Independent bass and treble controls
5. **Sound Card EQ**: Separate EQ for audio interface devices

### Protocol Characteristics

1. **Binary Protocol**: All data transmitted as binary byte arrays
2. **Big-Endian**: Multi-byte integers use big-endian byte order
3. **Attribute-Based**: Uses AttrBean type/value pairs
4. **Event-Driven**: Changes trigger callbacks to registered listeners

### Improvement Opportunities

If PEQ support with Q values is desired, the following changes would be needed:

1. **Firmware Protocol Extension**: Add new AttrBean types for PEQ parameters
2. **Data Model Updates**: Extend EqInfo to include Q values and filter types
3. **Command Builders**: Create new methods for PEQ control
4. **Parser Updates**: Handle new PEQ data formats in RcspDataHandler

### Value Ranges

Based on the code analysis:

- **EQ Mode**: 0-127 (7-bit value)
- **EQ Gain Values**: Signed byte (-128 to +127), actual dB range device-dependent
- **Bass/Treble**: 32-bit signed integers, range device-dependent
- **Frequency Values**: 16-bit unsigned integers (0-65535 Hz)

---

## Usage Examples

### Setting Bass and Treble

```java
// Set bass to 5 and treble to 3
CommandBase cmd = CommandBuilder.buildSetHighAndBassCmd(5, 3);
// Send cmd to device...
```

### Setting EQ (Dynamic Format)

```java
// Set EQ mode 2 with custom gains for 8 bands
byte mode = 2;
byte[] gains = new byte[] {0, 5, 10, 8, 0, -5, -3, 0};
CommandBase cmd = CommandBuilder.buildSetEqValueCmd(true, mode, gains);
// Send cmd to device...
```

### Getting Current EQ and Bass/Treble

```java
// Get EQ preset info and current values
CommandBase eqCmd = CommandBuilder.buildGetEqPresetAndEqValueCmd();

// Get bass and treble
CommandBase bassCmd = CommandBuilder.buildGetHighAndBassCmd();

// Send commands and handle responses in callback
```

### Listening for Changes

```java
public class MyListener extends OnRcspEventListener {
    @Override
    public void onHighAndBassChange(BluetoothDevice device, int bass, int treble) {
        Log.d(TAG, "Bass: " + bass + ", Treble: " + treble);
    }

    @Override
    public void onEqChange(BluetoothDevice device, EqInfo eqInfo) {
        Log.d(TAG, "EQ Mode: " + eqInfo.getMode());
        Log.d(TAG, "EQ Values: " + Arrays.toString(eqInfo.getValue()));
        Log.d(TAG, "EQ Freqs: " + Arrays.toString(eqInfo.getFreqs()));
    }
}
```

---

## References

### Source Files

- `com/jieli/jl_rcsp/util/CommandBuilder.java` - Command construction
- `com/jieli/jl_rcsp/tool/RcspDataHandler.java` - Response parsing
- `com/jieli/jl_rcsp/model/device/EqInfo.java` - EQ data model
- `com/jieli/jl_rcsp/model/device/EqPresetInfo.java` - Preset data model
- `com/jieli/jl_rcsp/interfaces/rcsp/OnRcspEventListener.java` - Event interface
- `com/jieli/jl_rcsp/tool/callback/RcspEventListenerManager.java` - Event dispatcher

### Related Documentation

- JieLi RCSP Protocol Specification (if available)
- Device firmware documentation

---

**Document Version**: 1.0
**Last Updated**: 2025-01-17
**Author**: Claude Code Analysis
