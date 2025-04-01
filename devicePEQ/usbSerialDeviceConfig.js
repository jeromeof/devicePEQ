// Dynamically import the USB Serial handler
const { jdsLabsUsbSerial } = await import('./jdsLabsUsbSerialHandler.js');

export const usbSerialDeviceHandlerConfig = [
  {
    vendorId: 0x16C0, // JDS Labs USB Vendor ID (common for JDS Labs / Teensy based boards)
    manufacturer: "JDS Labs",
    handler: jdsLabsUsbSerial,
    devices: {
      "Element IV": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots: 1,
          disconnectOnSave: false,
          disabledPresetId: -1,
          availableSlots: [{ id: 0, name: "User PEQ" }]
        }
      }
    }
  }
];
