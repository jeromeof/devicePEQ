// Dynamically import manufacturer specific handlers for their unique devices
const {fiioUsbHID} = await import('./fiioUsbHidHandler.js');
const {walkplayUsbHID} = await import('./walkplayHidHandler.js');
const {moondropUsbHidHandler} = await import('./moondropUsbHidHandler.js');
const {ktmicroUsbHidHandler} = await import('./ktmicroUsbHidHandler.js');
const {qudelixUsbHidHandler} = await import('./qudelixUsbHidHandler.js');

// Main list of HID devices - each vendor has one or more vendorId, and a list of devices associated,
// each device has a model of how the slots are configured and a handler to handle reading / writing
// the raw USBHID reports to the device
export const usbHidDeviceHandlerConfig = ([
  {
    vendorIds: [0x2972],
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
      availableSlots: []
    },
    devices: {
      "JadeAudio JA11": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: 3,
          maxWritableEQSlots: 1,
          disconnectOnSave: true,
          disabledPresetId: 4,
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
          availableSlots: [{id: 0, name: "Jazz"}, {id: 1, name: "Pop"}, {id: 2, name: "Rock"}, {
            id: 3,
            name: "Dance"
          }, {
            id: 4,
            name: "R&B"
          }, {id: 5, name: "Classic"}, {id: 6, name: "Hip-hop"}, {id: 160, name: "USER1"}, {id: 161, name: "USER2"}, {
            id: 162,
            name: "USER3"
          }, {id: 160, name: "USER1"}, {id: 161, name: "USER2"}, {id: 162, name: "USER3"}, {id: 163, name: "USER4"}, {
            id: 164,
            name: "USER5"
          }, {id: 165, name: "USER6"}, {id: 166, name: "USER7"}, {id: 167, name: "USER8"}, {id: 168, name: "USER9"}, {
            id: 169,
            name: "USER10"
          }]
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
      "K17": {
        modelConfig: {}
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
      maxGain: 12,
      maxFilters: 8,
      schemeNo: 10,
      firstWritableEQSlot: -1,
      maxWritableEQSlots: 0,
      disconnectOnSave: false,
      disabledPresetId: -1,
      availableSlots: [{id: 101, name: "Custom"}]
    },
    devices: {
      "MOONDROP RAYS": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler
      },
      "MOONDROP Marigold": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler
      },
      "Quark2": {
        manufacturer: "Moondrop"
      },
      "ECHO-A": {
        manufacturer: "Moondrop"
      },
      "FreeDSP Pro": {
        manufacturer: "Moondrop"
      },
      "BGVP MX1": {
        modelConfig: {
          schemeNo: 15
        }
      },
      "DT04": {
        manufacturer: "LETSHUOER",
        modelConfig: {
          schemeNo: 15
        }
      },
      "MD-QT-042": {
        manufacturer: "Moondrop",
        modelConfig: {
          schemeNo: 15
        }
      },
      "MOONDROP HiFi with PD": {
        manufacturer: "Moondrop",
        modelConfig: {
          schemeNo: 15
        }
      },
      "DAWN PRO 2": {
        manufacturer: "Moondrop",
        modelConfig: {
          schemeNo: 15
        }
      },
      "CS431XX": {
        modelConfig: {
          schemeNo: 15
        }
      },
      "ES9039 ": {
        modelConfig: {
          schemeNo: 15
        }
      },
      "TANCHJIM-STARGATE II": {
        manufacturer: "Tanchim",
        modelConfig: {
          schemeNo: 15
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
          schemeNo: 15
        }
      },
      "ES9039 HiFi DSP Audio": {
        modelConfig: {
          schemeNo: 15
        }
      },
      "AE6": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
        }
      },
      "KM_HA03": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
        }
      },
      "TP35 Pro": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
        }
      },
      "DA5": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
        }
      },
      "G303": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
        }
      },
      "HiFi DSP Audio with PD": {
        manufacturer: "ddHifi",
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
        }
      },
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
      disconnectOnSave: false,
      disabledPresetId: -1,
      availableSlots: [{id: 101, name: "Custom"}]
    }
  },
  {
    vendorIds: [0x0A12], // Qudelix 5K vendor ID
    manufacturer: "Qudelix",
    handler: qudelixUsbHidHandler,
    defaultModelConfig: {
      minGain: -12,
      maxGain: 12,
      maxFilters: 10, // Qudelix 5K supports 10 PEQ bands
      firstWritableEQSlot: 1,
      maxWritableEQSlots: 4,
      disconnectOnSave: false,
      disabledPresetId: -1,
      availableSlots: [
        {id: 101, name: "Custom"},
        {id: 1, name: "Preset 1"},
        {id: 2, name: "Preset 2"},
        {id: 3, name: "Preset 3"},
        {id: 4, name: "Preset 4"}
      ]
    },
    devices: {
      "5K": {
        modelConfig: {} // Inherit from default
      }
    }
  }
])
