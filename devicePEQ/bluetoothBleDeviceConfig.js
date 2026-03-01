// bluetoothBleDeviceConfig.js

const { airohaBle } = await import('./airohaBleHandler.js');

export const bluetoothBleDeviceHandlerConfig = [
  // ── Audeze Maxwell ────────────────────────────────────────────────────────
  // Airoha-chipset BLE GATT.  4 presets (0-3), 10 bands each.
  // Service:  5052494d-2dab-0341-6972-6f6861424c45
  // TX char:  43484152-2dab-3241-6972-6f6861424c45  (write-without-response)
  // RX char:  43484152-2dab-3141-6972-6f6861424c45  (notify)
  {
    manufacturer: "Audeze",
    handler: airohaBle,
    filters: {
      namePrefix: "Audeze Maxwell",
      services: ["5052494d-2dab-0341-6972-6f6861424c45"]
    },
    gatt: {
      serviceUuid:           "5052494d-2dab-0341-6972-6f6861424c45",
      txCharacteristicUuid:  "43484152-2dab-3241-6972-6f6861424c45",
      rxCharacteristicUuid:  "43484152-2dab-3141-6972-6f6861424c45"
    },
    devices: {
      "Audeze Maxwell": {
        modelConfig: {
          minGain:            -12,
          maxGain:             12,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  4,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          flatEQPhoneMeasurement: "Audeze Maxwell Flat EQ",
          availableSlots: [
            { id: 0, name: "Preset 1" },
            { id: 1, name: "Preset 2" },
            { id: 2, name: "Preset 3" },
            { id: 3, name: "Preset 4" }
          ]
        }
      }
    }
  },

];
