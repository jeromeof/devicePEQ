# DevicePEQ

DevicePEQ is a browser-side JavaScript plugin for reading, editing, and writing parametric equalizer (PEQ) settings on compatible audio devices. It is designed to be embedded in a host page such as CrinGraph and uses the browser's WebHID, Web Serial, Web Bluetooth, and Fetch APIs; no native application or build step is required.

## What it does

- Connects to devices over USB HID, USB Serial, Bluetooth SPP, Bluetooth BLE, or local HTTP.
- Pulls the current PEQ, lets the host graph/table edit it, and pushes the result back to the device.
- Handles device-specific packet formats, slot/preset layouts, report IDs, baud rates, and protocol quirks.
- Applies per-device limits for filter count, gain, Q, frequency, and supported filter types.
- Supports device extras where implemented, including EQ enable/disable, DAC filter, DAC work mode, gain mode, balance, microphone gain, denoise, battery status, and output gain.
- Supports host/device pregain policies and protocol compensation for Q, frequency, and shelving filters where required.
- Provides experimental-device warnings, diagnostic logging, feedback capture, and disconnect handling.
- Can automatically load a configured neutral headphone measurement and route audio through a connected BLE headphone for inverse-EQ monitoring.

## Embedding the plugin

Import `plugin.js` from the host page and call `initializeDeviceEqPlugin` after the host EQ UI is ready:

```html
<div class="extra-eq"></div>

<script type="module">
  import initializeDeviceEqPlugin from './devicePEQ/plugin.js';

  await initializeDeviceEqPlugin({
    elemToFilters: () => getFiltersFromHostUi(),
    config: {
      advanced: true,
      showExtras: true,
      debugLogs: false
    }
  });
</script>
```

The host must provide the `.extra-eq` container and an `elemToFilters` callback. The plugin adds the connection controls, slot selector, pull/push actions, constraint information, extras controls, and feedback UI. `advanced: true` exposes Serial/Bluetooth and Network connection options; otherwise the normal picker is limited to the basic connection types.

Useful configuration options include:

| Option | Purpose |
| --- | --- |
| `advanced` | Show Serial/Bluetooth and Network connection choices. |
| `showExtras` | Show supported hardware controls next to the slot selector. |
| `debugLogs` / `showLogs` | Enable detailed DevicePEQ logging. |
| `captureConsoleLogs` | Retain console output for the feedback form. |
| `peqConstraintsUrl` | Override the URL of `peqConstraintsConfig.json`. |

## Supported connection families

### USB HID

USB HID is the main path for DSP dongles and cables. Current handlers cover FiiO, Walkplay-compatible devices, KTMicro, Moondrop, Conexant, Topping, and Fosi Audio protocols. The configuration also supports device groups and scheme variants, so several products can share a handler while using different slot maps or constraint profiles.

Known/tested families include FiiO/Jade Audio JA11, KA15, KA17, FX17, and QX13; Walkplay-based products such as Moondrop Marigold, Chu II DSP, Quark2 DSP, Tanchjim Stargate II, Space Pro, One DSP, Bunny DSP, EPZ TP13, KiwiEars Allegro/Allegro Pro, JCally JM98 Max/Hi-Max, DDHiFi DSP Cable, NiceHCK Octave, and CrinEar Protocol Max; KTMicro products including Moondrop CDSP, Tanchjim Fission, KiwiEars Allegro Mini, Chorus, S-Link, KT02H20, and JCally JM12; plus Fosi Audio DS3.

### USB Serial and Bluetooth SPP

`usbSerialConnector.js` uses Web Serial for both USB serial devices and paired Bluetooth Classic SPP ports. It currently includes:

- JDS Labs Element IV.
- Nothing Headphone (1), with the Custom slot as the writable preset.
- FiiO USB DSP devices and FiiO EH11/EH13 over SPP.
- Tanchjim Rita.
- Moondrop Edge / Edge ANC.
- EarFun Tune Pro (write-only graphic EQ).
- Edifier W830NB / ConnectX (write-only, four-band EQ).

When several SPP configurations share a service UUID, the connector displays a device-choice dialog and remembers the selection in a cookie.

### Bluetooth BLE

`bluetoothBleConnector.js` currently supports:

- Audeze Maxwell through the Airoha GATT protocol, with four ten-band preset slots.
- FiiO EH11 and EH13 through FiiO's proprietary BLE GATT service, with a ten-band custom EQ.

BLE devices can expose audio output information for the monitoring workflow. Browser support and permissions vary by browser and operating system.

### Network

The network connector uses the device's local IP address and currently supports:

- **WiiM:** HTTP/HTTPS parametric EQ push. Pull is normally unavailable from an HTTPS-hosted page because of browser CORS/mixed-content restrictions.
- **Luxsin X9:** local HTTP read and write, using the Luxsin/WalkPlay encoded payload format.

Network support is exposed in advanced mode and requires the browser to be able to reach the device on the local network.

## PEQ constraints

`peqConstraintsConfig.json` is the canonical registry of filter capabilities. A device model normally selects a named profile with `peqConstraintsRef`; `peqConstraintsOverride` can adjust a profile for one model. The resolver also supports legacy inline fields for compatibility.

The public API in `peqConstraints.js` includes:

```js
import {
  loadPeqConstraintsConfig,
  resolveConstraints,
  findConstraintsByDeviceName,
  findConstraintsByDeviceGroupName,
  searchDevices,
  getConstraintEntry
} from './peqConstraints.js';
```

Constraint resolution is performed during connection, so the UI and handlers receive the effective limits for the connected device rather than generic defaults.

## Repository layout

| File | Responsibility |
| --- | --- |
| `plugin.js` | Host integration, UI, connection picker, pull/push workflow, extras, logging, and feedback. |
| `usbHidConnector.js` | WebHID discovery, model resolution, connection lifecycle, and HID operations. |
| `usbDeviceConfig.js` | USB HID vendor/product/device-group mappings and model configuration. |
| `usbSerialConnector.js` | Web Serial and Bluetooth SPP discovery, disambiguation, and serial operations. |
| `usbSerialDeviceConfig.js` | USB serial and SPP device mappings. |
| `bluetoothBleConnector.js` | Web Bluetooth discovery and GATT connection lifecycle. |
| `bluetoothBleDeviceConfig.js` | BLE service, characteristic, and model mappings. |
| `networkDeviceConnector.js` | Network device lifecycle and common network operations. |
| `networkDeviceConfig.js` | WiiM and Luxsin model configuration. |
| `peqConstraints.js` | Constraint loading, lookup, search, and resolution. |
| `deviceExtras.js` | Common interface for optional hardware controls. |
| `compensation.js` | Q, frequency, and shelf compensation used by protocol handlers. |
| `*Handler.js` | Manufacturer- or protocol-specific wire-format implementations. |

## Browser requirements

Use a current Chromium-based browser for the broadest support. WebHID, Web Serial, and Web Bluetooth require a secure context in most deployments, user interaction for device pickers, and explicit permission. Bluetooth SPP devices must be paired with the computer before they appear in the serial-port picker. Network devices must be reachable from the browser, and local HTTP/HTTPS or CORS policy can affect read operations.

## Testing and diagnostics

The repository includes mock-device tests and protocol capture tools under `tests/` and `testing/`. For a real-device report, include the model, connection type, slot, operation (pull or push), browser/OS, and the DevicePEQ console logs. Experimental devices enable additional logging and show a warning before connection.

Device support changes frequently. For the authoritative current mappings, inspect `usbDeviceConfig.js`, `usbSerialDeviceConfig.js`, `bluetoothBleDeviceConfig.js`, `networkDeviceConfig.js`, and `peqConstraintsConfig.json`.
