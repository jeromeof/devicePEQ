// bluetoothBleDeviceConfig.js

const { airohaBle } = await import('./airohaBleHandler.js');
const { fiioBle }   = await import('./fiioBleHandler.js');
const { walkplayBle, discoverWalkplayBleGatt, WALKPLAY_BLE_ADVERTISED_SERVICES, WALKPLAY_BLE_GATT_SERVICES } =
  await import('./walkplayBleHandler.js');

export const bluetoothBleDeviceHandlerConfig = [
  // ── WalkPlay DSP dongles with BLE ────────────────────────────────────────
  // Same command set as the USB HID handler, tunnelled over GATT (see
  // walkplayBleHandler.js). Matched by advertised service 0xFF16/0xFF17, not by
  // name (they advertise as "Audio_BLE"), so new WalkPlay BLE products work too.
  // BLE can't read all PEQ bands back (indexed reads return band 0), so this
  // is write-only for PEQ; read the curve over USB if needed.
  // Verified: CB1300 with BLE (USB 0x3302:0xB301, 8 bands) and CS43198-SGM8262-TFT-BLE
  // (0x3302:0x4333, 10 bands).
  {
    manufacturer: "WalkPlay",
    handler: walkplayBle,
    filters: { services: WALKPLAY_BLE_ADVERTISED_SERVICES, anyService: true },
    gatt: {
      optionalServices: WALKPLAY_BLE_GATT_SERVICES,
      discover: discoverWalkplayBleGatt,
    },
    // On connect walkplayBle.onConnected reads the CHIP_ID (= USB VID/PID) and replaces
    // this with the same SchemeNo group config USB uses (bands, filters, compensation),
    // plus a band count remembered from USB detection for that PID. These defaults only
    // apply if the chip ID can't be read.
    defaultModelConfig: {
      peqConstraintsRef:   "walkplayPeq8Band10dBFullShelves",
      writeOnly:          true,
      peqConstraintsOverride: { supportsRead: false },
      firstWritableEQSlot: 101,
      maxWritableEQSlots:  1,
      disconnectOnSave:    false,
      deviceHandlesPregain: false,
      experimental:        true,
      defaultResetFiltersValues: [{ gain: 0, freq: 100, q: 1, filterType: "PK" }],
      availableSlots: [{ id: 101, name: "Custom" }],
      dacWorkMode: { supported: false },  // BLE 0x20 is not the USB DAC work mode
      dacBalance: { supported: false },   // BLE payload differs from USB — not mapped yet
      gainMode:   { supported: true },    // write-only over BLE (Low/High)
      denoise:    { supported: true },    // ENC: BLE cmd 0x31 (AI ENC dongles)
    },
    devices: {},
  },

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
      peqConstraintsRef:   'bleExtras',
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
        measurementName:  "Audeze Maxwell",
        audioOutputName:  "Audeze Maxwell BT",
        modelConfig: {
          minGain:            -12,
          maxGain:             12,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  4,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
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
