// bluetoothBleDeviceConfig.js

const { airohaBle } = await import('./airohaBleHandler.js');
const { fiioBle }   = await import('./fiioBleHandler.js');

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
          experimental:        true,
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

  // ── FiiO EH11 / EH13 ─────────────────────────────────────────────────────
  // FiiO proprietary BLE GATT.  Single custom-EQ slot, 10 bands.
  // Service:  00001100-04a5-1000-1000-40ed981a04a5
  // Write:    00001101-04a5-1000-1000-40ed981a04a5
  // Notify:   00001102-04a5-1000-1000-40ed981a04a5
  // Packet:   F1 10 00 LL  CC CC  [payload]  FF
  {
    manufacturer: "FiiO",
    handler: fiioBle,
    filters: {
      // FiiO devices appear with either "FiiO" or "FIIO" prefix in their BLE name
      namePrefix: "FiiO",
      services: ["00001100-04a5-1000-1000-40ed981a04a5"]
    },
    gatt: {
      serviceUuid:          "00001100-04a5-1000-1000-40ed981a04a5",
      txCharacteristicUuid: "00001101-04a5-1000-1000-40ed981a04a5",
      rxCharacteristicUuid: "00001102-04a5-1000-1000-40ed981a04a5"
    },
    devices: {
      "FiiO EH11": {
        modelConfig: {
          minGain:            -20,
          maxGain:             20,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      },
      "FiiO EH13": {
        modelConfig: {
          minGain:            -20,
          maxGain:             20,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      },
      // Some FiiO devices advertise with all-uppercase name
      "FIIO EH11": {
        modelConfig: {
          minGain:            -20,
          maxGain:             20,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      },
      "FIIO EH13": {
        modelConfig: {
          minGain:            -20,
          maxGain:             20,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      }
    }
  }
];
