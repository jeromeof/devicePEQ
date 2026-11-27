# Sony WH-1000XM5: browser EQ feasibility from Android source

Analyzed 2026-09-05. Evidence is the decompiled Android source in `Sony SoundsConnect/sources`; old Python tools and prior analysis documents are not used as protocol authorities. Browser API feasibility is checked against Chrome's official documentation. No hardware communication was performed.

## Conclusion

A browser implementation is plausible through **Web Serial over Sony's custom Bluetooth Classic RFCOMM service**. The app's Tandem protocol has actual read-current-EQ and set-EQ commands. The EQ model is graphic: fixed band metadata plus level steps, not arbitrary PEQ frequency/Q/type/coefficient writes.

The APK discovers supported command-table sets and capabilities from the connected device; the source does not supply a simple hardcoded WH-1000XM5-to-service mapping. Confirm the available service and responses on the user's XM5 before declaring model support. The expected standard layout is Clear Bass plus 400 Hz, 1 kHz, 2.5 kHz, 6.3 kHz and 16 kHz. This source also handles other layouts; querying the device is preferable to assuming six values or a gain range.

[Standard band model](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/mdr/j2objc/application/eqlisteningcomparison/EqBandStepsStandard.java:15>), [service selection](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/mdr/platform/connection/connection/x0.java:46>), [discovery](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/rm/a.java:50>).

## Browser transport

The app defines two normal service UUIDs:

| Service class ID | App factory |
|---|---|
| `96cc203e-5068-46ad-b32d-e316f5e069ba` | Command table set 1, `Bl.c` |
| `956c7b26-d49a-4ba8-b03f-b17d393cb6e2` | Command table set 2, `Bl.d` |

The app prefers table set 2 when both are discovered. The other UUID in each pair in `Yl/i.java` is an Android reversed-UUID workaround, not a second service to blindly probe. [UUID definitions/order](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Yl/i.java:18>), [set 1 factory](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Bl/c.java:11>), [set 2 factory](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Bl/d.java:11>), [reversed-UUID explanation](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/rm/a.java:40>).

`Rm.b` calls `createRfcommSocketToServiceRecord(eVar.b())`, then constructs the Tandem connection. This directly establishes the Android transport used by these factories. [Socket creation](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/rm/b.java:36>).

Chrome supports custom RFCOMM service class IDs through `navigator.serial.requestPort({allowedBluetoothServiceClassIds, filters})`; this is not restricted to standard SPP UUID 1101. Desktop Chrome is a suitable first test target. [Official Chrome documentation](https://developer.chrome.com/blog/serial-over-bluetooth).

Browser selection sketch (must run from a user click, with the headset paired in the OS):

```js
const sonyServices = [
  '956c7b26-d49a-4ba8-b03f-b17d393cb6e2',
  '96cc203e-5068-46ad-b32d-e316f5e069ba',
];
const port = await navigator.serial.requestPort({
  allowedBluetoothServiceClassIds: sonyServices,
  filters: sonyServices.map(bluetoothServiceClassId => ({ bluetoothServiceClassId })),
});
console.log(port.getInfo());
await port.open({ baudRate: 115200 });
```

115200 is a Web Serial configuration choice consistent with existing devicePEQ handlers, not an APK-derived Sony UART baud requirement. The browser's ability to enumerate/open this service on the particular OS/headset remains to be tested. Do not hardcode an RFCOMM channel number. If another client occupies the service, close its connection before testing.

The existing [devicePEQ serial connector](../../../devicePEQ/usbSerialConnector.js:95) already gathers custom service IDs and supplies readable/writable access. Sony needs its own handler and a persistent protocol receive loop. Use one reader owner; per-request readers can lose unsolicited notifications or block ACK processing. Integrate cancellation and reader/writer cleanup on disconnect.

### Why not the obvious BLE UUID?

`Ur.a` defines service `45C93E07-D90D-4B93-A9DB-91E5DD734E35`, command `…3C15…`, response `…3C16…`, and event `…3C17…`. Its base class names those roles explicitly. However the call site `Tr.b` installs it in the **sensor communication library** with a sensor Bluetooth address and client ID. That is not evidence that it transports Tandem EQ commands. [UUIDs](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Ur/a.java:41>), [roles](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Lr/d.java:62>), [sensor call site](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/tr/b.java:340>).

Web Bluetooth communicates with BLE GATT services; it cannot substitute for the RFCOMM socket above. No source-verified BLE route for these XM5 EQ commands was established in this investigation. Presence of writable GATT characteristics alone is insufficient. [Official Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth).

## Tandem framing and reliability

Logical frame before escaping:

```text
3E TYPE SEQ LEN32_BE PAYLOAD CHECKSUM 3C
```

For the EQ table-1 messages in both table sets, TYPE is `0C` (`DATA_MDR`). SEQ alternates between 0 and 1. Length is four-byte big-endian payload length. CHECKSUM is the low byte of the sum of TYPE, SEQ, the four length bytes and payload. Exclude 3E/3C delimiters. It is an **additive checksum**, even though some app log messages call it CRC.

Escape the entire interior, including checksum, after calculating the checksum:

| Original byte | Wire bytes |
|---|---|
| 3C | 3D 2C |
| 3D | 3D 2D |
| 3E | 3D 2E |

[Frame writer](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Dl/b.java:69>), [sum implementation](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Pm/f.java:19>), [escape encoder](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Pm/b.java:11>), [escape constants](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Dl/e.java:6>), [receive parser](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Dl/a.java:55>), [MDR data type](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/tandemfamily/message/mdr/v1/table1/a.java:19>).

Start outgoing sequence at 0. A DATA frame with sequence `s` expects ACK sequence `1-s`; that ACK value becomes the next outgoing sequence. ACK received DATA messages with the opposite sequence too. ACK frames have type 01 and zero-length payload:

```text
ACK of received DATA seq 0: 3E 01 01 00 00 00 00 02 3C
ACK of received DATA seq 1: 3E 01 00 00 00 00 00 01 3C
```

Keep outgoing and received sequence state separately. A duplicate incoming DATA frame should be acknowledged again but not applied twice. Retransmit an unacknowledged outgoing frame with its original sequence. The app sends one command at a time, waiting for ACK with 750 ms timeout and a retry limit of 10. This ACK means transport receipt, not that an EQ read response has arrived or that the resulting settings match a write.

[Sequence/ACK/retry controller](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Yl/C8155c.java:61>), [sequence inversion](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Pm/d.java:4>), [timeout/retry arguments](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Bl/e.java:335>).

A receive loop must handle fragmented frames and multiple frames per read, unescape, validate length/checksum, process ACKs, acknowledge incoming DATA, and route response/notification payloads. Do not assume one serial read equals one message. The included offline decoder takes one complete frame and deliberately does not implement this connection state machine.

## EQ payloads

The following are **inner payloads**, not bytes to send directly to a BLE characteristic or unframed serial socket. They cover customizable PRESET_EQ inquiry type `01`; do not generalize to other inquiry variants without their parsers.

| Purpose | Request | Response |
|---|---|---|
| Capabilities, English | `50 01 01` | `51 01 BAND_COUNT LEVEL_STEPS PRESET_COUNT …` |
| Availability/status | `52 01` | `53 01 STATUS` |
| Read current parameters | `56 01` | `57 01 PRESET_ID COUNT STEP…` |
| Set parameters | `58 01 PRESET_ID COUNT STEP…` | Follow with readback; parameter notification is `59 01 …` |
| Band metadata | `5A 01` | `5B 01 COUNT [TYPE VALUE_H VALUE_L]…` |

Capability preset entries are `[ID NAME_LENGTH NAME_BYTES…]`. The reference codec retains name bytes rather than assuming a text encoding. English is **01**, as defined in `MdrLanguage`; 00 is undefined language. Do not mistake the capability's band count and level-step count for signed min/max gain values.

Source chain: [capability request](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/hl/C6120l.java:23>), [capability response](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/hl/A0.java:117>), [v2 capability response](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Xl/s.java:44>), [status response](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/hl/D0.java:22>), [parameter request](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/hl/C6124n.java:20>), [parameter response](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/hl/C0.java:65>), [v2 parameter response](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Xl/A.java:34>), [v2 parameter structure](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Yl/c.java:28>), [language](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/tandemfamily/mdr/param/MdrLanguage.java:7>).

Band metadata type `01` means Hz, `02` means kHz, and `10` means specific information. Specific value `0001` is Clear Bass. This metadata describes fixed controls; it is not a setter for band frequency. Preserve Clear Bass as a separate special control, not an invented peaking filter. [Band metadata parser](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Jl/C6168s.java:34>), [types](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/tandemfamily/message/mdr/v1/table1/param/EqBandInformationType.java:5>), [Clear Bass identifier](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/tandemfamily/message/mdr/v1/table1/param/SpecificInformationType.java:3>).

### Level conversion

The UI converts a wire step into a centred level:

```text
midpoint = floor((LEVEL_STEPS - 1) / 2)
UI level = wire step - midpoint
wire step = UI level + midpoint
```

For a device reporting 21 levels: 0 → −10, 10 → 0, 20 → +10. A −3 control setting is encoded as **07**, not FD. Treat Clear Bass as its own Sony control scale rather than assuming its number describes a conventional filter gain in dB. [v1 conversion](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Ch/c.java:78>), [v2 conversion](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Dh/h.java:108>), [v2 unsigned step serialization](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Yl/c.java:28>).

### Preset semantics differ between app table sets

The v1 app's `Ch.c.n` changes band steps with preset ID **FF (UNSPECIFIED)**; its preset-selection method sends the selected preset ID with zero band count. The v2 app's `Dh.h.n` passes the selected preset ID with the step array. Therefore do not hardcode A0 for all writes or assume FF is universally interchangeable with a custom slot. Read capabilities/current preset, preserve the table-set distinction, and confirm the selected preset's behavior on the XM5.

The enum contains A0 (Custom) and A1…A5 user settings, but that does not mean the XM5 implements all of them. Expose only device-reported presets. [v1 write method](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Ch/c.java:144>), [v2 write method](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/Dh/h.java:165>), [preset IDs](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/com/sony/songpal/tandemfamily/message/mdr/v1/table1/param/EqPresetId.java:38>).

### Hand-derived examples

Read parameters with outgoing sequence 0:

```text
3E 0C 00 00 00 00 02 56 01 65 3C
```

Capability query in English, outgoing sequence 0:

```text
3E 0C 00 00 00 00 03 50 01 01 61 3C
```

These are independent examples for a fresh sequence state; do not send both as seq 0 in the same acknowledged session.

An illustrative parameter response payload for six flat controls and 21 levels:

```text
57 01 A0 06 0A 0A 0A 0A 0A 0A
```

An illustrative v1 band-edit payload using the app's FF convention:

```text
58 01 FF 06 0A 0A 0A 0A 0A 0A
```

These are calculated examples, not captured XM5 traffic.

## What devicePEQ can represent

A suitable first implementation is **read/write graphic EQ plus Clear Bass**, with fixed frequencies and discrete levels obtained from capabilities. Readback is genuinely represented in the app protocol, unlike the EarFun Professional EQ cache path investigated earlier.

No writable frequency, Q, filter-type, preamp or biquad-coefficient fields were found in the examined Tandem EQ path. A PEQ target could be approximated by fitting the available fixed-band controls after their acoustic responses are characterized. That would be an approximation, not native PEQ support. Do not claim the Android source proves undocumented firmware PEQ is impossible.

For devicePEQ, add a Sony-specific serial handler with readback, capability-based limits, a continuously running receive/ACK loop and an explicit Clear Bass extra. The current Tune Pro/EarFun packet builder is not reusable. A generic fixed-Q PK rendering of Sony's curve would also be a modelling assumption until measured.

## First hardware test and remaining unknowns

1. Pair the WH-1000XM5 with desktop Chrome's host OS and use a user-click Web Serial picker with both Sony UUIDs. Record `port.getInfo()` and selected table set.
2. Start the framed receive/ACK loop before issuing queries. The app has protocol-info and supported-function discovery (`00 00` is the v1 protocol-info payload); implement/record startup rather than assuming all EQ calls work immediately after opening the socket. [Protocol-info request](</Users/joflaherty/Downloads/Sony SoundsConnect/sources/hl/C6145y.java:19>).
3. Query capabilities, current parameters and band metadata. Confirm band count, step midpoint, ordered Clear Bass/frequency metadata, supported presets and status. Save exact RX/TX packets.
4. Only then, on a user-requested write, change one control, use the table-set-appropriate preset semantics, read back and compare. Preserve a backup of the initial parameters for restoration.
5. Verify reconnect/power-cycle persistence separately. Test notification-driven changes and what happens if Sound Connect reconnects.

Still unverified: which custom service this physical XM5 advertises; full initialization required by its firmware; host-specific service availability; write/preset persistence; actual acoustic filter shapes. This report establishes source-derived feasibility, not a completed hardware integration.

## Offline artifacts

[codec.mjs](codec.mjs) provides framing/escaping/checksum, complete-frame decoding, ACK construction, EQ read/capability/band-info payloads, capability/parameter parsing and validated step writes. It neither connects nor modifies devicePEQ production registration.

Run `node --test testing/protocol-docs/sony-wh1000xm5/codec.test.mjs` from the repository root. Three tests cover known vectors, both ACK values, escaping all reserved bytes, checksum rejection, capability-derived gain conversion and malformed payload rejection. Tests use hand-derived/synthetic data; no old Python output or hardware capture is used as an oracle.
