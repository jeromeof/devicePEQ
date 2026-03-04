// bluetoothBleDeviceConfig.js

const { airohaBle } = await import('./airohaBleHandler.js');
const { fiioBle }   = await import('./fiioBleHandler.js');

export const bluetoothBleDeviceHandlerConfig = [
  // ── FiiO EH11 / EH13 ─────────────────────────────────────────────────────
  // FiiO proprietary BLE GATT. 10-band PEQ, single custom EQ slot.
  // Service:  00001100-04a5-1000-1000-40ed981a04a5
  // TX char:  00001101-04a5-1000-1000-40ed981a04a5  (EH11: write-without-response, EH13: write-with-response)
  // RX char:  00001102-04a5-1000-1000-40ed981a04a5
  {
    manufacturer: "FiiO",
    handler: fiioBle,
    filters: { namePrefix: "FIIO" },
    gatt: {
      serviceUuid:          "00001100-04a5-1000-1000-40ed981a04a5",
      txCharacteristicUuid: "00001101-04a5-1000-1000-40ed981a04a5",
      rxCharacteristicUuid: "00001102-04a5-1000-1000-40ed981a04a5",
    },
    defaultModelConfig: {
      minGain:             -20,
      maxGain:              20,
      maxFilters:           10,
      firstWritableEQSlot:  0,
      maxWritableEQSlots:   1,
      disconnectOnSave:     false,
      disabledPresetId:    -1,
      experimental:         false,
      availableSlots: [{ id: 0, name: "Custom EQ" }],
    },
    devices: {
      "FIIO EH11": { modelConfig: {} },
      "FIIO EH13": { modelConfig: {} },
    },
  },

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
          flatEQPhoneMeasurement: "Audeze Maxwell Flat",
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
