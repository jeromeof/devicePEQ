// Dynamically import the USB Serial handlers
const { jdsLabsUsbSerial } = await import('./jdsLabsUsbSerialHandler.js');
const { nothingUsbSerial } = await import('./nothingUsbSerialHandler.js');
const { fiioUsbSerial } = await import('./fiioUsbSerialHandler.js');

export const usbSerialDeviceHandlerConfig = [
  {
    vendorId: 0x152a, // JDS Labs USB Vendor ID (common for JDS Labs / Teensy based boards)
    manufacturer: "JDS Labs",
    handler: jdsLabsUsbSerial,
    devices: {
      "Element IV": {
        usbProductId: 35066,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots: 1,
          disconnectOnSave: false,
          disabledPresetId: -1,
          experimental: false,
          availableSlots: [{ id: 0, name: "Headphones" },{ id: 1, name: "RCA" }]
        }
      }
    }
  },
  {
    // Nothing headphones support both USB Serial and Bluetooth SPP
    manufacturer: "Nothing",
    handler: nothingUsbSerial,
    // Enhanced filtering - support both USB vendor ID and Bluetooth SPP UUID
    filters: {
      // USB Serial filtering (if connected via USB)
      usbVendorId: null, // Nothing doesn't have a specific USB vendor ID for headphones
      // Bluetooth SPP filtering (primary connection method)
      allowedBluetoothServiceClassIds: ["aeac4a03-dff5-498f-843a-34487cf133eb"],
      bluetoothServiceClassId: "aeac4a03-dff5-498f-843a-34487cf133eb"
    },
    devices: {
      "Nothing Headphones": {
        // No specific USB product ID since these are primarily Bluetooth devices
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 8, // Based on the EQ values parsing in the HTML
          firstWritableEQSlot: 5,
          maxWritableEQSlots: 1, // Only the Custom profile is writable
          disconnectOnSave: false,
          disabledPresetId: -1,
          experimental: false,
          readOnly: false, // Enable writing for Custom profile
          flatEQPhoneMeasurement: "Nothing HP1 Balanced", // Auto-load this flat EQ measurement on connection
          availableSlots: [
            { id: 0, name: "Balanced" },
            { id: 1, name: "Voice" },
            { id: 2, name: "More Treble" },
            { id: 3, name: "More Bass" },
            { id: 5, name: "Custom" }
          ]
        }
      }
    }
  },
  {
    vendorId: 6790, // FiiO USB Vendor ID
    manufacturer: "FiiO",
    handler: fiioUsbSerial,
    devices: {
      "FiiO Audio DSP": {
        usbProductId: 21971,
        modelConfig: {
          // Serial configuration
          baudRate: 57600,

          // Model capabilities
          minGain: -12,
          maxGain: 12,
          maxFilters: 10, // Typical FiiO EQ band count
          firstWritableEQSlot: 0,
          maxWritableEQSlots: 21, // Support for all FiiO presets
          disconnectOnSave: false,
          disabledPresetId: 11, // Based on FiiO code showing preset 11 for disabled EQ
          experimental: false,
          availableSlots: [
            { id: 240, name: "BYPASS" },
            { id: 0, name: "Jazz" },
            { id: 1, name: "Pop" },
            { id: 2, name: "Rock" },
            { id: 3, name: "Dance" },
            { id: 4, name: "R&B" },
            { id: 5, name: "Classic" },
            { id: 6, name: "Hip Hop" },
            { id: 8, name: "Retro" },
            { id: 9, name: "De-essing-1" },
            { id: 10, name: "De-essing-2" },
            { id: 160, name: "USER1" },
            { id: 161, name: "USER2" },
            { id: 162, name: "USER3" },
            { id: 163, name: "USER4" },
            { id: 164, name: "USER5" },
            { id: 165, name: "USER6" },
            { id: 166, name: "USER7" },
            { id: 167, name: "USER8" },
            { id: 168, name: "USER9" },
            { id: 169, name: "USER10" }
          ]
        }
      }
    }
  }
];
