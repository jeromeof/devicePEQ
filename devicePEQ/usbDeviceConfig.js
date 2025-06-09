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
    vendorIds: [0x2972, 0x0A12],
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
      experimental: true,
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
      "SNOWSKY Melody": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: -1,
          maxWritableEQSlots: 0,
          disconnectOnSave: true,
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
            experimental: false,
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
          experimental: false,
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
          experimental: false,
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
          experimental: false,
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
          experimental: false,
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
          experimental: false,
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
          experimental: false,
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
          experimental: false,
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
          experimental: false
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
          experimental: false,
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
      },
      "Qudelix-5K USB DAC 48KHz": {
        handler: qudelixUsbHidHandler,
        manufacturer: "Qudelix",
        defaultModelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10, // Qudelix 5K supports 10 PEQ bands
          firstWritableEQSlot: 1,
          maxWritableEQSlots: 4,
          disconnectOnSave: false,
          disabledPresetId: -1,
          experimental: true,
          availableSlots: [
            {id: 101, name: "Custom"},
            {id: 1, name: "Preset 1"},
            {id: 2, name: "Preset 2"},
            {id: 3, name: "Preset 3"},
            {id: 4, name: "Preset 4"}
          ]
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
      experimental: false,
      availableSlots: [{id: 101, name: "Custom"}]
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
        supportsLSHSFilters: false,
        supportsPregain: true,
      },
      "EPZ TP13 AI ENC audio": {
        manufacturer: "EPZ",
        modelConfig: {
          supportsLSHSFilters: false,
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
        handler: moondropUsbHidHandler
      },
      "ddHiFi DSP IEM - Memory": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler
      },
      "Quark2": {
        manufacturer: "Moondrop"
      },
      "ECHO-A": {
        manufacturer: "Moondrop"
      },
      "Hi-MAX": {
        modelConfig: {
          experimental: false
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
          experimental: true
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
          schemeNo: 15,
          experimental: true
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
      },
      "AE6": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          experimental: true
        }
      },
      "KM_HA03": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          experimental: true
        }
      },
      "TP35 Pro": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10
        }
      },
      "DA5": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          experimental: true
        }
      },
      "G303": {
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          experimental: true
        }
      },
      "HiFi DSP Audio with PD": {
        manufacturer: "ddHifi",
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          experimental: true
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
  }
])
