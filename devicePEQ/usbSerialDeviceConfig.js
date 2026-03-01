// usbSerialDeviceConfig.js
// Dynamically import all USB Serial / Bluetooth SPP handlers

const { jdsLabsUsbSerial }       = await import('./jdsLabsUsbSerialHandler.js');
const { nothingUsbSerial }       = await import('./nothingUsbSerialHandler.js');
const { fiioUsbSerial }          = await import('./fiioUsbSerialHandler.js');
const { fiioSppSerial }          = await import('./fiioSppSerialHandler.js');
const { airohaUsbSerial }        = await import('./airohaUsbSerialHandler.js');
const { ritaUsbSerial }          = await import('./ritaUsbSerialHandler.js');
const { moondropEdgeUsbSerial }  = await import('./moondropEdgeUsbSerialHandler.js');
const { earfunUsbSerial }        = await import('./earfunUsbSerialHandler.js');
const { edifierUsbSerial }       = await import('./edifierUsbSerialHandler.js');

export const usbSerialDeviceHandlerConfig = [

  // ── JDS Labs Element IV ───────────────────────────────────────────────────
  {
    vendorId:     0x152a,
    manufacturer: "JDS Labs",
    handler:      jdsLabsUsbSerial,
    devices: {
      "Element IV": {
        usbProductId: 35066,
        modelConfig: {
          minGain:            -12,
          maxGain:             12,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          availableSlots: [
            { id: 0, name: "Headphones" },
            { id: 1, name: "RCA" }
          ]
        }
      }
    }
  },

  // ── Nothing Headphone (1) ─────────────────────────────────────────────────
  // Classic Bluetooth SPP with a Nothing-specific service class UUID.
  // Slot 5 ("Custom") is the only writable slot; slots 0-3 are read-only presets.
  {
    manufacturer: "Nothing",
    handler:      nothingUsbSerial,
    filters: {
      usbVendorId:                       null,
      allowedBluetoothServiceClassIds:   ["aeac4a03-dff5-498f-843a-34487cf133eb"],
      bluetoothServiceClassId:           "aeac4a03-dff5-498f-843a-34487cf133eb"
    },
    devices: {
      "Nothing Headphones": {
        modelConfig: {
          minGain:                  -12,
          maxGain:                   12,
          maxFilters:                 8,
          firstWritableEQSlot:        5,
          maxWritableEQSlots:         1,
          disconnectOnSave:           false,
          disabledPresetId:          -1,
          experimental:               false,
          readOnly:                   false,
          flatEQPhoneMeasurement:    "Nothing HP1 Balanced",
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

  // ── FiiO USB Serial (DSP dongle) ──────────────────────────────────────────
  {
    vendorId:     6790,
    manufacturer: "FiiO",
    handler:      fiioUsbSerial,
    devices: {
      "FiiO Audio DSP": {
        usbProductId: 21971,
        modelConfig: {
          baudRate:            57600,
          minGain:            -12,
          maxGain:             12,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  21,
          disconnectOnSave:    false,
          disabledPresetId:    11,
          experimental:        false,
          availableSlots: [
            { id: 240, name: "BYPASS"     },
            { id: 0,   name: "Jazz"       },
            { id: 1,   name: "Pop"        },
            { id: 2,   name: "Rock"       },
            { id: 3,   name: "Dance"      },
            { id: 4,   name: "R&B"        },
            { id: 5,   name: "Classic"    },
            { id: 6,   name: "Hip Hop"    },
            { id: 8,   name: "Retro"      },
            { id: 9,   name: "De-essing-1"},
            { id: 10,  name: "De-essing-2"},
            { id: 160, name: "USER1"      },
            { id: 161, name: "USER2"      },
            { id: 162, name: "USER3"      },
            { id: 163, name: "USER4"      },
            { id: 164, name: "USER5"      },
            { id: 165, name: "USER6"      },
            { id: 166, name: "USER7"      },
            { id: 167, name: "USER8"      },
            { id: 168, name: "USER9"      },
            { id: 169, name: "USER10"     }
          ]
        }
      }
    }
  },

  // ── FiiO EH11 / EH13 (Bluetooth SPP) ─────────────────────────────────────
  // Classic Bluetooth SPP (standard UUID), 115200 baud.
  // Same F1 10 packet framing used on the BLE GATT path.
  // 10-band parametric EQ with read + write support.
  {
    manufacturer: "FiiO",
    handler:      fiioSppSerial,
    filters: {
      allowedBluetoothServiceClassIds: ["00001101-0000-1000-8000-00805f9b34fb"],
      bluetoothServiceClassId:         "00001101-0000-1000-8000-00805f9b34fb"
    },
    devices: {
      "FiiO EH11": {
        modelConfig: {
          baudRate:            115200,
          minGain:            -20,
          maxGain:             20,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          flatEQPhoneMeasurement: "FiiO EH11 NeutralEQ",
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      },
      "FiiO EH13": {
        modelConfig: {
          baudRate:            115200,
          minGain:            -20,
          maxGain:             20,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          flatEQPhoneMeasurement: "FiiO EH13 NeutralEQ",
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      }
    }
  },

  // ── Tanchjim Rita ─────────────────────────────────────────────────────────
  // Classic Bluetooth SPP (standard UUID), 9600 baud.
  // 12-band parametric EQ with read + write support.
  // Protocol: FF A1/A2 frame with 7-byte band encoding (gain×100, q×100, freq Hz).
  {
    manufacturer: "Tanchjim",
    handler:      ritaUsbSerial,
    filters: {
      allowedBluetoothServiceClassIds: ["00001101-0000-1000-8000-00805f9b34fb"],
      bluetoothServiceClassId:         "00001101-0000-1000-8000-00805f9b34fb"
    },
    devices: {
      "Tanchjim Rita": {
        modelConfig: {
          baudRate:            9600,
          minGain:            -15,
          maxGain:             15,
          maxFilters:          12,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          flatEQPhoneMeasurement: "Tanchjim Rita Default ANC",
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      }
    }
  },

  // ── Moondrop Edge ANC ─────────────────────────────────────────────────────
  // Classic Bluetooth SPP (standard UUID), 115200 baud.
  // 5-band parametric EQ with read + write support.
  // Quirky shifted-gain encoding: gain for band N lives in band N+1's header slot.
  {
    manufacturer: "Moondrop",
    handler:      moondropEdgeUsbSerial,
    filters: {
      allowedBluetoothServiceClassIds: ["00001101-0000-1000-8000-00805f9b34fb"],
      bluetoothServiceClassId:         "00001101-0000-1000-8000-00805f9b34fb"
    },
    devices: {
      "Moondrop Edge": {
        modelConfig: {
          baudRate:            115200,
          minGain:            -12,
          maxGain:             12,
          maxFilters:           5,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          flatEQPhoneMeasurement: "Moondrop Edge Default",
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      }
    }
  },

  // ── EarFun Tune Pro ───────────────────────────────────────────────────────
  // Classic Bluetooth SPP (standard UUID), 115200 baud.
  // 10-band graphic EQ — WRITE ONLY (device does not return EQ data).
  // Fixed Q factor; frequency and gain per band.
  {
    manufacturer: "EarFun",
    handler:      earfunUsbSerial,
    filters: {
      allowedBluetoothServiceClassIds: ["00001101-0000-1000-8000-00805f9b34fb"],
      bluetoothServiceClassId:         "00001101-0000-1000-8000-00805f9b34fb"
    },
    devices: {
      "EarFun Tune Pro": {
        modelConfig: {
          baudRate:            115200,
          minGain:            -12,
          maxGain:             12,
          maxFilters:          10,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          writeOnly:           true,
          flatEQPhoneMeasurement: "EarfunTunePro-ANC-Default",
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      }
    }
  },

  // ── Edifier (ConnectX headphones) ─────────────────────────────────────────
  // Classic Bluetooth SPP (standard UUID), 115200 baud.
  // 4-band parametric EQ — WRITE ONLY.
  // Gain range: ±6 dB.  Frequency limited to ~21 verified lookup-table entries.
  {
    manufacturer: "Edifier",
    handler:      edifierUsbSerial,
    filters: {
      allowedBluetoothServiceClassIds: ["00001101-0000-1000-8000-00805f9b34fb"],
      bluetoothServiceClassId:         "00001101-0000-1000-8000-00805f9b34fb"
    },
    devices: {
      "Edifier W830NB": {
        modelConfig: {
          baudRate:            115200,
          minGain:             -6,
          maxGain:              6,
          maxFilters:           4,
          firstWritableEQSlot: 0,
          maxWritableEQSlots:  1,
          disconnectOnSave:    false,
          disabledPresetId:   -1,
          experimental:        false,
          writeOnly:           true,
          flatEQPhoneMeasurement: "Edifier 830NB Custom EQ 0db",
          availableSlots: [{ id: 0, name: "Custom EQ" }]
        }
      }
    }
  }
];
