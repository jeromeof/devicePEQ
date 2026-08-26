# DevicePEQ

DevicePEQ is a browser-side JavaScript plugin for reading, editing, and writing parametric equalizer (PEQ) settings on compatible audio devices. It is designed to be embedded in a host page such as CrinGraph and uses the browser's WebHID, Web Serial, Web Bluetooth, and Fetch APIs; no native application or build step is required.

**Version:** `v0.21` is the latest published release. The repository currently contains post-`v0.21` changes being prepared for `v0.22`; `v0.22` has not been tagged or published yet.

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

USB HID is the main path for DSP dongles and cables. Current handlers cover FiiO, Walkplay-compatible devices, KTMicro, Moondrop, Conexant, Topping, and Fosi Audio protocols; Topping detection is currently disabled (see below). The configuration also supports device groups and scheme variants, so several products can share a handler while using different slot maps or constraint profiles.

The registry also contains product-ID groups for WalkPlay schemes 10, 11, 13, 15, 16, 17, 18, 19, 20, and 21, and KT Micro groups for Kiwi Ears Chorus, Allegro variants, and S-Link. These groups allow additional compatible products to be matched even when their USB product name is generic.

The current USB HID model registry is broader than the short family summary above. Published model names and supported aliases in `usbDeviceConfig.js` are:

- **FiiO:** QX13, SnowSky Melody, JadeAudio JIEZI, JadeAudio JA11, KA17, Q7, BT11, Air Link, BTR13, BTR17, K19, K17, K15, KA15, K13 R2R, BR15 R2R, FP3, SnowSky TINY A, SnowSky TINY B, FG3, OAK NANO, RETRO NANO, QX11, and AIR AMP. `FIIO KA17 (MQA HID)`, `FIIO BT11 (UAC1.0)`, `BTR17`, and `Oak Nano` are retained product-name aliases.
- **WalkPlay-compatible:** Tanchjim Space Pro, Tanchjim OLA II DSP, Tanchjim Stargate II, Tanchjim One DSP, Tanchjim Bunny DSP, Tanchjim Fission, Moondrop Old Fashioned, Rays, Marigold, FreeDSP, FreeDSP Mini, FreeDSP Pro, MoonRiver 3, DAWN PRO2, Echo A, ECHO-B, AG Rays, DHA15, Deco Audio System, INN Deco75-DH Audio, ddHiFi DSP IEM - Memory, ddHiFi DSP Cable - Memory, CrinEar Protocol Max, NiceHCK Octave, CS43131 HiFi Audio DSP, CS43198 HiFi DSP Audio, and Truthear KEYX. `MOONDROP Marigold` and `didiHiFi DSP Cable - Memory` are product-name aliases.
- **KT Micro:** Kiwi Ears Allegro Pro, Kiwi Ears Allegro Mini, Kiwi Ears Chorus, Kiwi Ears S-Link, JCally KT02H20, Tanchjim One DSP, Tanchjim Bunny DSP, Tanchjim Fission, Moondrop CDSP, and Moondrop Chu2 DSP. Hyphenated and spacing variants of Allegro Mini and Fission are also registered.
- **Fosi Audio:** DS3.

The following configured USB HID entries remain **experimental** and are shown with the experimental-device warning: FiiO LS-TC2 and DM15 R2R; WalkPlay-compatible BGVP MX1, LETSHUOER DT04, Moondrop MD-QT-042, Moondrop HiFi with PD, CS431XX, ES9039, Dual CS43198, and ES9039 HiFi DSP Audio; and KT Micro Space Gaming IEM. Topping detection is currently disabled because its vendor ID is shared with Fosi Audio DS3. Qudelix 5K/5K+ USB HID support is also excluded; its EQ read path requires BLE support that is not currently implemented.

### USB Serial and Bluetooth SPP

`usbSerialConnector.js` uses Web Serial for both USB serial devices and paired Bluetooth Classic SPP ports. It currently includes:

- JDS Labs Element IV.
- Nothing Headphones (Headphone (1)), with the Custom slot as the writable preset.
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

Device support changes frequently. This page describes the published registry currently in the repository; the configuration files remain authoritative for exact product-name matching, aliases, scheme assignments, and constraints. Inspect `usbDeviceConfig.js`, `usbSerialDeviceConfig.js`, `bluetoothBleDeviceConfig.js`, `networkDeviceConfig.js`, and `peqConstraintsConfig.json` for the current mappings.
