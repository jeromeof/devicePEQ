// Dynamically import the USB Serial handlers
const { jdsLabsUsbSerial } = await import('./jdsLabsUsbSerialHandler.js');
const { nothingUsbSerial } = await import('./nothingUsbSerialHandler.js');

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
          experimental: true,
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
          firstWritableEQSlot: 0,
          maxWritableEQSlots: 5, // Support for 5 EQ profiles (no 6th mode)
          disconnectOnSave: false,
          disabledPresetId: -1,
          experimental: true,
          readOnly: false, // Enable writing for Custom profile
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
  }
];
