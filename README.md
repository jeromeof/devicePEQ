# DevicePEQ

DevicePEQ is a browser-side JavaScript plugin for reading, editing, and writing
parametric equalizer (PEQ) settings on compatible audio devices. It is designed
to be embedded in a host page such as CrinGraph. It uses browser APIs directly;
there is no native application or build step.

`v0.21` is the latest published release. The repository contains post-`v0.21`
work being prepared for `v0.22`, but `v0.22` has not been tagged or published.

## Features

- USB HID, USB Serial, Bluetooth Classic SPP, Bluetooth BLE, and local-network
  device connections.
- Device-specific PEQ pull/push, preset-slot selection, filter constraints, and
  protocol compensation.
- Optional device controls such as EQ enable, DAC filter, DAC work mode, gain
  mode, balance, microphone gain, denoise, battery status, and output gain when
  supported by the connected device.
- Host/device pregain handling and support for peak, shelf, low-pass, high-pass,
  notch, band-stop, constant-Q, and all-pass filters where a device supports
  them.
- Experimental-device warnings, diagnostic logging, feedback capture, and
  disconnect handling.
- Optional neutral headphone measurements and BLE audio routing for inverse-EQ
  monitoring when the device exposes the required information.

## Quick integration

The plugin expects the host page to provide an element with class `extra-eq`.
It inserts its UI after that element by default. The host must also provide an
`elemToFilters` callback that returns the current filter array.

```html
<div class="extra-eq"></div>

<script type="module">
  import initializeDeviceEqPlugin
    from './devicePEQ/plugin.js';

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

The complete standalone markup and a working example are in
[`index.html`](index.html). The plugin injects the connection controls, slot
selector, pull/push actions, constraint information, extras panel, help modal,
and feedback UI.

### Configuration

| Option | Description |
| --- | --- |
| `advanced` | Exposes Serial/SPP, BLE, and Network choices in the device picker. |
| `showExtras` | Shows supported hardware controls. |
| `debugLogs` / `showLogs` | Enables DevicePEQ diagnostic logging. |
| `captureConsoleLogs` | Captures relevant logs for the feedback form. |
| `peqConstraintsUrl` | Overrides the URL of `peqConstraintsConfig.json`. |
| `devicePEQAnchorDiv` | Changes the CSS selector used as the insertion anchor. |
| `devicePEQPlacement` | Changes the `insertAdjacentHTML` placement value. |

The function returns a promise and requires a secure context in browsers that
enforce secure-context rules for WebHID, Web Serial, or Web Bluetooth.

## Connection support

### USB HID

USB HID is the primary path for DSP dongles and cables. The current registry
contains FiiO, WalkPlay-compatible, KTMicro, Moondrop, Conexant, and Fosi Audio
handlers. The Topping handler remains in the repository, but Topping detection
is currently disabled because its vendor ID is shared with Fosi Audio DS3.

The named published models, aliases, experimental entries, and product-ID
scheme groups are maintained in [`devicePEQ/index.md`](devicePEQ/index.md).
That document is the human-readable support list; the configuration itself is
authoritative for exact USB product-name matching and constraints.

### USB Serial and Bluetooth SPP

[`usbSerialConnector.js`](devicePEQ/usbSerialConnector.js) supports:

- JDS Labs Element IV over USB Serial.
- Nothing Headphones (Headphone (1)) over its Bluetooth SPP service, with the
  Custom slot writable.
- FiiO USB DSP devices and FiiO EH11/EH13 over SPP.
- Tanchjim Rita.
- Moondrop Edge and Edge ANC.
- EarFun Tune Pro, write-only graphic EQ.
- Edifier W830NB / ConnectX, write-only four-band EQ.

Bluetooth Classic devices generally need to be paired with the operating
system before they appear in the Web Serial picker. If multiple SPP devices
share a service UUID, DevicePEQ asks the user to choose a configuration and
remembers that choice in a cookie.

### Bluetooth BLE

[`bluetoothBleConnector.js`](devicePEQ/bluetoothBleConnector.js) currently
supports:

- Audeze Maxwell through the Airoha GATT protocol, with four ten-band preset
  slots.
- FiiO EH11 and EH13 through FiiO's proprietary GATT service, with one custom
  ten-band EQ slot.

BLE permissions and available services vary by browser and operating system.

### Network

[`networkDeviceConnector.js`](devicePEQ/networkDeviceConnector.js) supports:

- **WiiM:** HTTP/HTTPS PEQ push. Pull is normally unavailable from an HTTPS
  page because of CORS and mixed-content restrictions.
- **Luxsin X9:** local HTTP read and write using the Luxsin/WalkPlay payload
  format.

Network devices must be reachable from the browser. Network connection
controls are exposed only when `advanced` is enabled.

## Constraints and device configuration

[`devicePEQ/peqConstraintsConfig.json`](devicePEQ/peqConstraintsConfig.json)
is the canonical registry of filter limits and capabilities. Models normally
select a named profile with `peqConstraintsRef`; a
`peqConstraintsOverride` can adjust that profile for one model. Legacy inline
constraint fields remain supported.

The public constraint API is:

```js
import {
  loadPeqConstraintsConfig,
  getPeqConstraintsConfig,
  getConstraintsByRef,
  getConstraintEntry,
  getAllConstraintRefs,
  findConstraintsByDeviceName,
  findConstraintsByDeviceGroupName,
  searchDevices,
  getExtras,
  resolveExtras,
  resolveConstraints
} from './devicePEQ/peqConstraints.js';
```

Constraint data is loaded and cached on demand. `resolveConstraints` applies
the model's named profile and any per-model override so handlers and the UI
receive the effective limits for the connected device.

## Source layout

| Path | Purpose |
| --- | --- |
| `devicePEQ/plugin.js` | Host integration, UI, connection picker, pull/push workflow, extras, logging, and feedback. |
| `devicePEQ/*DeviceConfig.js` | USB HID, serial/SPP, BLE, and network model registries. |
| `devicePEQ/*Connector.js` | Browser transport discovery and connection lifecycle. |
| `devicePEQ/*Handler.js` | Manufacturer- and protocol-specific wire formats. |
| `devicePEQ/peqConstraints.js` | Constraint lookup, search, and resolution. |
| `devicePEQ/deviceExtras.js` | Common interface for optional hardware controls. |
| `devicePEQ/compensation.js` | Q, frequency, and shelving compensation. |
| `devicePEQ/builtin-capture/` | Browser-native sweep, capture, FFT, deconvolution, and response tools. |
| `testing/` | Mock devices, payload recording, and the browser test framework. |
| `tests/` | Handler and connector regression tests, captures, and test harness pages. |
| `bluetooth_tools/` | BLE/SPP diagnostic pages, scripts, and protocol notes. |
| `testing/html-tools/` | Standalone device and protocol test pages. |
| `sharePEQ/`, `visualizePEQ/`, `subjectizePEQ/`, `treblizerPEQ/` | Related browser plugins and host integrations. |

## Testing

The repository does not currently define a root npm package or build command.
Tests are browser-oriented because the production code depends on WebHID, Web
Serial, Web Bluetooth, and the DOM.

The browser test page is [`tests/testHarness.html`](tests/testHarness.html).
The mock testing API is also available from [`testing/index.js`](testing/index.js):

```js
import TestInterface from './testing/index.js';

await TestInterface.runAllTests();
TestInterface.listAvailableDevices();
TestInterface.listTestSuites();
```

The test framework includes mock HID/serial/network/BLE devices, recorded
payload exchanges, handler tests, connector-routing tests, and integration
tests. Real-device captures are stored under `tests/captures/` and should be
used only as regression fixtures.

The built-in capture backend has its own standalone page at
[`devicePEQ/builtin-capture/builtin-capture.html`](devicePEQ/builtin-capture/builtin-capture.html).
It rejects input/output clock mismatches by default so browser resampling is
not mistaken for part of the measured response path.

## Browser requirements and limitations

Use a current Chromium-based browser for the broadest transport support.
WebHID, Web Serial, and Web Bluetooth normally require a secure context and a
user gesture for their device pickers. Bluetooth SPP devices must be paired
first. BLE has no access to A2DP, AVRCP, or HFP; it can only use requested GATT
services. Network support is subject to browser CORS, mixed-content, and local
network policies.

Never write a preset to hardware unless the connected model and slot are
correct. Experimental entries are not fully validated and display a warning
before connection.

## Release artifact

Pushing a tag matching `v*.*` runs the GitHub Actions release workflow. It
archives the `devicePEQ/` and `sharePEQ/` directories as `devicePEQ.zip` and
creates a GitHub release with generated notes.

## Feedback and contributions

The plugin includes a feedback form for experimental-device reports. Users can
include the model, connection type, slot, operation, browser/OS, comments, and
captured DevicePEQ logs. Pull requests and issue reports are welcome.

For a useful device report, include the exact product name, connection type,
operation (pull or push), browser/OS, and relevant console output.

## License

See [`LICENSE.txt`](LICENSE.txt).
