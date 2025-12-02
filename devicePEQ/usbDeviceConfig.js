// Dynamically import manufacturer specific handlers for their unique devices
const {fiioUsbHID} = await import('./fiioUsbHidHandler.js');
const {walkplayUsbHID} = await import('./walkplayHidHandler.js');
const {moondropUsbHidHandler} = await import('./moondropUsbHidHandler.js');
const {ktmicroUsbHidHandler} = await import('./ktmicroUsbHidHandler.js');
const {qudelixUsbHidHandler} = await import('./qudelixUsbHidHandler.js');
const {toppingUsbHidHandler} = await import('./toppingUsbHidHandler.js');

// Main list of HID devices - each vendor has one or more vendorId, and a list of devices associated,
// each device has a model of how the slots are configured and a handler to handle reading / writing
// the raw USBHID reports to the device
export const usbHidDeviceHandlerConfig = ([
  {
    vendorIds: [0x2972,0x0A12],
    manufacturer: "FiiO",
    handler: fiioUsbHID,
    defaultModelConfig: { // Fallback if we haven't got specific details yet
      minGain: -12,
      maxGain: 12,
      maxFilters: 5,
      firstWritableEQSlot: -1,
      maxWritableEQSlots: 0,
      disconnectOnSave: true,
      disabledPresetId: -1,
      experimental: false,
      supportsLSHSFilters: true,
      supportsPregain: true,
      defaultResetFiltersValues:[{gain:0, freq: 100, q:1, filterType: "PK"}],
      reportId: 7,
      availableSlots: [
        {id: 0, name: "Jazz"},
        {id: 1, name: "Pop"},
        {id: 2, name: "Rock"},
        {id: 3, name: "Dance"},
        {id: 4, name: "R&B"},
        {id: 5, name: "Classic"},
        {id: 6, name: "Hip-hop"},
        {id: 7, name: "Monitor"},
        {id: 160, name: "USER1"},
        {id: 161, name: "USER2"},
        {id: 162, name: "USER3"},
        {id: 163, name: "USER4"},
        {id: 164, name: "USER5"},
        {id: 165, name: "USER6"},
        {id: 166, name: "USER7"},
        {id: 167, name: "USER8"},
        {id: 168, name: "USER9"},
        {id: 169, name: "USER10"}
      ]
    },
    devices: {
      "FIIO QX13": {
        modelConfig: {
          maxFilters: 10,
          disconnectOnSave: false
        }
      },
      "SNOWSKY Melody": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: -1,
          disabledPresetId: 240,
          maxWritableEQSlots: 0,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 5,
            name: "R&B"
          }, {id: 6, name: "Classic"}, {id: 7, name: "Hip-hop"}, {id: 160, name: "USER1"}, {id: 161, name: "USER2"}, {
            id: 162,
            name: "USER3"
          }]

        }
      },
      "JadeAudio JIEZI": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
          modelConfig: {
            minGain: -12,
            maxGain: 12,
            maxFilters: 5,
            firstWritableEQSlot: 3,
            maxWritableEQSlots: 1,
            disconnectOnSave: true,
            disabledPresetId: 4,
            reportId: 2,
          }
        },
      "JadeAudio JA11": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: 3,
          maxWritableEQSlots: 1,
          disconnectOnSave: true,
          disabledPresetId: 4,
          reportId: 2,
          availableSlots: [{id: 0, name: "Vocal"}, {id: 1, name: "Classic"}, {id: 2, name: "Bass"}, {
            id: 3,
            name: "USER1"
          }]
        }
      },
      "FIIO KA17": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          reportId: 1,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 5,
            name: "R&B"
          }, {id: 6, name: "Classic"}, {id: 7, name: "Hip-hop"}, {id: 4, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "FIIO Q7": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          reportId: 1,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 5,
            name: "R&B"
          }, {id: 6, name: "Classic"}, {id: 7, name: "Hip-hop"}, {id: 4, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "FIIO KA17 (MQA HID)": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          reportId: 1,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 5,
            name: "R&B"
          }, {id: 6, name: "Classic"}, {id: 7, name: "Hip-hop"}, {id: 4, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "FIIO BT11 (UAC1.0)": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          reportId: 1,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 5,
            name: "R&B"
          }, {id: 6, name: "Classic"}, {id: 7, name: "Hip-hop"}, {id: 4, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "FIIO Air Link": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          reportId: 1,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 5,
            name: "R&B"
          }, {id: 6, name: "Classic"}, {id: 7, name: "Hip-hop"}, {id: 4, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "FIIO BTR13": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 12,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 4,
            name: "R&B"
          }, {id: 5, name: "Classic"}, {id: 6, name: "Hip-hop"}, {id: 7, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "BTR17": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
        }
      },
      "FIIO KA15": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 4,
            name: "R&B"
          }, {id: 5, name: "Classic"}, {id: 6, name: "Hip-hop"}, {id: 7, name: "USER1"}, {id: 8, name: "USER2"}, {
            id: 9,
            name: "USER3"
          }]
        }
      },
      "FIIO K13 R2R": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 10,
          maxWritableEQSlots: 10,
          disconnectOnSave: false,
          disabledPresetId: 11,
          reportId: 1,
          availableSlots: [
            {id: 0, name: "BYPASS"},
            {id: 1, name: "Jazz"},
            {id: 2, name: "Pop"},
            {id: 3, name: "Rock"},
            {id: 4, name: "Dance"},
            {id: 5, name: "R&B"},
            {id: 6, name: "Classic"},
            {id: 7, name: "Hip-Pop"},
            {id: 8, name: "De-essing 1"},
            {id: 9, name: "De-essing 2"},
            {id: 10, name: "USER1"},
            {id: 11, name: "USER2"},
            {id: 12, name: "USER3"},
            {id: 13, name: "USER4"},
            {id: 14, name: "USER5"},
            {id: 15, name: "USER6"},
            {id: 16, name: "USER7"},
            {id: 17, name: "USER8"},
            {id: 18, name: "USER9"},
            {id: 19, name: "USER10"}
          ]
        }
      },
      "LS-TC2": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: 3,
          maxWritableEQSlots: 1,
          disconnectOnSave: true,
          disabledPresetId: 11,
          experimental: true,
          availableSlots: [{id: 0, name: "Vocal"}, {id: 1, name: "Classic"}, {id: 2, name: "Bass"}, {
            id: 3,
            name: "Dance"
          }, {id: 4, name: "R&B"}, {id: 5, name: "Classic"}, {id: 6, name: "Hip-hop"}, {id: 160, name: "USER1"}]
        }
      }
    }
  },
  {
    vendorIds: [0x3302, 0x0762, 0x35D8, 0x2FC6, 0x0104, 0xB445, 0x0661, 0x0666, 0x0D8C], // multiple Walkplay vendorIds
    manufacturer: "WalkPlay",
    handler: walkplayUsbHID,
    defaultModelConfig: {
      minGain: -12,
      maxGain: 6,
      maxFilters: 8,
      schemeNo: 10,
      firstWritableEQSlot: -1,
      maxWritableEQSlots: 0,
      disconnectOnSave: false,
      disabledPresetId: -1,
      supportsPregain: true,
      defaultResetFiltersValues:[{gain:0, freq: 100, q:1, filterType: "PK"}],
      supportsLSHSFilters: false,
      autoGlobalGain: false,
      experimental: false,
      availableSlots: [{id: 101, name: "Custom"}]
    },
    deviceGroups: {
      "SchemeNo11": {
        productIds: [0x13D4,0x98C0,0x98C0,0x93D1,0x13D7,0x12C0,0x1264,0x43D1,0x1266,0x51C0,0x13C1,0x13D3,0x1251,0x1262,0x1261,0x12C1,0x98D5],
        modelConfig: {
          supportsLSHSFilters: false,
          supportsPregain: true
        }
      },
      "SchemeNo16": {
        productIds: [0x4380, 0x43B6,0x43E1,0x43D7,0x43D8,0x43E4,0x98D4,0x43C0,0x43E8,0xF808,0xEE10,0x4352,0xEE20,0x43C5,0x43E6,0x4351,0x43DE,0x4358,0x4359,0x43DB,0x435A,0x4355,0x435C,0x435D,0x435E,0x43EF,0x43EC,0x4361,0x4363,0x4366,0x4364,0x4360,0x4382,0x4383,0x4386,0x43C6,0x43C7,0x011D,0x43C8,0x43DA,0x43C9,0x43CA,0x43CC,0x43CD,0x43CF,0x43B1,0x43C2,0x43B7,0x43B8,0x39C3],
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          minGain: -10,
          maxGain: 10,
          autoGlobalGain: false,
          supportsLSHSFilters: true,
          supportsPregain: true
        }
      }
    },
    devices: {
      "FIIO FX17 ": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          experimental: false,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 7, name: "Monitor"},
            {id: 160, name: "USER1"},
            {id: 161, name: "USER2"},
            {id: 162, name: "USER3"},
            {id: 163, name: "USER4"},
            {id: 164, name: "USER5"},
            {id: 165, name: "USER6"},
            {id: 166, name: "USER7"},
            {id: 167, name: "USER8"},
            {id: 168, name: "USER9"},
            {id: 169, name: "USER10"}
          ]
        }
      },
      "Rays": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSHSFilters: true,
          supportsPregain: true,
        }
      },
      "Marigold": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSHSFilters: false,
          supportsPregain: true,
        }
      },
      "FreeDSP Pro": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSHSFilters: true,
          supportsPregain: true,
        }
      },
      "ddHiFi DSP IEM - Memory": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler
      },
      "Protocol Max": {
        manufacturer: "CrinEar",
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          minGain: -10,
          maxGain: 10,
          autoGlobalGain: true,
          supportsLSHSFilters: true,
          supportsPregain: true
        }
      },
      "Truthear KEYX": {
        manufacturer: "Truthear",
        handler: walkplayUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 6,
          maxFilters: 8,
          firstWritableEQSlot: -1,
          maxWritableEQSlots: 0,
          disconnectOnSave: false,
          disabledPresetId: -1,
          supportsPregain: true,
          supportsLSHSFilters: false,
          experimental: false,
          defaultIndex: 0x17,
          availableSlots: [{id: 101, name: "Custom"}]
        }
      },
      "BGVP MX1": {
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "DT04": {
        manufacturer: "LETSHUOER",
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "MD-QT-042": {
        manufacturer: "Moondrop",
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "MOONDROP HiFi with PD": {
        manufacturer: "Moondrop",
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "DAWN PRO 2": {
        manufacturer: "Moondrop",
        modelConfig: {
          schemeNo: 15,
          experimental: false
        }
      },
      "CS431XX": {
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "ES9039 ": {
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "TANCHJIM-STARGATE II": {
        manufacturer: "Tanchim",
        modelConfig: {
          schemeNo: 15,
          supportsLSHSFilters: false
        }
      },
      "didiHiFi DSP Cable - Memory": {
        manufacturer: "ddHifi",
        modelConfig: {
          schemeNo: 15
        }
      },
      "Dual CS43198": {
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      },
      "ES9039 HiFi DSP Audio": {
        modelConfig: {
          schemeNo: 15,
          experimental: true
        }
      }
    }
  },
  {
    vendorIds: [0x31B2],
    manufacturer: "KT Micro",
    handler: ktmicroUsbHidHandler,
    defaultModelConfig: {
      minGain: -12,
      maxGain: 12,
      maxFilters: 5,
      firstWritableEQSlot: -1,
      maxWritableEQSlots: 0,
      compensate2X: true,  // Lets compenstate by default
      disconnectOnSave: true,
      disabledPresetId: 0x02,
      experimental: false,
      supportsPregain: false,
      supportsLSHSFilters: true,
      defaultResetFiltersValues:[{gain:0, freq: 100, q:1, filterType: "PK"}],
      availableSlots: [{id: 0x03, name: "Custom"}]
    },
    devices: {
      "Kiwi Ears-Allegro PRO": {
        manufacturer: "Kiwi Ears",
        modelConfig: {
          supportsLSHSFilters: false,
          disconnectOnSave: true,
        }
      },
      "KT02H20 HIFI Audio": {
        manufacturer: "JCally",
        modelConfig: {
          supportsLSHSFilters: false,
        }
      },
      "TANCHJIM BUNNY DSP": {
        manufacturer: "TANCHJIM",
        modelConfig: {
          compensate2X: false,
          supportsPregain: true,
        }
      },
      "TANCHJIM FISSION": {
        manufacturer: "TANCHJIM",
        modelConfig: {
          compensate2X: false,
          supportsPregain: true,
        }
      },
      "CDSP": {
        manufacturer: "Moondrop",
        modelConfig: {
          compensate2X: false
        }
      },
      "Chu2 DSP": {
        manufacturer: "Moondrop",
        modelConfig: {
          compensate2X: false
        }
      }
    }
  },
  {
    vendorIds: [0x152A], // 5418 in decimal = 0x152A in hex
    manufacturer: "Topping",
    handler: toppingUsbHidHandler,
    defaultModelConfig: {
      minGain: -12,
      maxGain: 12,
      maxFilters: 10,
      firstWritableEQSlot: 0,
      maxWritableEQSlots: 3,
      disconnectOnSave: false,
      disabledPresetId: -1,
      experimental: true,
      supportsPregain: true,
      supportsLSHSFilters: true,
      defaultResetFiltersValues:[{gain:0, freq: 100, q:1, filterType: "PK"}],
      availableSlots: [
        {id: 0, name: "Custom 1"},
        {id: 1, name: "Custom 2"},
        {id: 2, name: "Custom 3"}
      ]
    },
    devices: {
      "DX5 II": {
        productId: 0x8740, // 34640 in decimal = 0x8740 in hex
        modelConfig: {
          maxFilters: 10,
          experimental: true
        }
      }
    }
  }
])
