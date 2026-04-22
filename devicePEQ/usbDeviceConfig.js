// Dynamically import manufacturer specific handlers for their unique devices
const {fiioUsbHID} = await import('./fiioUsbHidHandler.js');
const {walkplayUsbHID} = await import('./walkplayHidHandler.js');
const {moondropUsbHidHandler} = await import('./moondropUsbHidHandler.js');
const {moondropOldFashionedUsbHID} = await import('./moondropOldFashionedUsbHidHandler.js');
const {ktmicroUsbHidHandler} = await import('./ktmicroUsbHidHandler.js');
const {qudelixUsbHidHandler} = await import('./qudelixUsbHidHandler.js');
const {toppingUsbHidHandler} = await import('./toppingUsbHidHandler.js');
const {fosiAudioUsbHID} = await import('./fosiAudioUsbHidHandler.js');

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
      supportsLSFilter: true,
      supportsHSFilter: true,
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
          disconnectOnSave: false,
          // Provided device presets mapping
          disabledPresetId: 240,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 10,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 8, name: "Retro"},
            {id: 160, name: "USER1"},
            {id: 161, name: "USER2"},
            {id: 162, name: "USER3"},
            {id: 163, name: "USER4"},
            {id: 164, name: "USER5"},
            {id: 165, name: "USER6"},
            {id: 166, name: "USER7"},
            {id: 167, name: "USER8"},
            {id: 168, name: "USER9"},
            {id: 169, name: "USER10"},
            {id: 240, name: "BYPASS"}
          ]
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
            firstWritableEQSlot: 160,
            maxWritableEQSlots: 3,
            disconnectOnSave: true,
            disabledPresetId: 240,
            reportId: 2,
            availableSlots: [
              {id: 0, name: "Jazz"},
              {id: 1, name: "Pop"},
              {id: 2, name: "Rock"},
              {id: 3, name: "Dance"},
              {id: 4, name: "R&B"},
              {id: 5, name: "Classic"},
              {id: 6, name: "Hip-hop"},
              {id: 160, name: "USER1"},
              {id: 161, name: "USER2"},
              {id: 162, name: "USER3"},
              {id: 240, name: "Close EQ"}
            ]
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
          saveCommandId: 0x21, // PEQ_SAVE_V2
        }
      },
      "FIIO K19": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 31,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          saveCommandId: 0x21, // PEQ_SAVE_V2
        }
      },
      "FIIO K17": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 31,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 3,
          disconnectOnSave: false,
          disabledPresetId: 11,
          saveCommandId: 0x21, // PEQ_SAVE_V2
        }
      },
      "FIIO K15": {
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
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 10,
          disconnectOnSave: false,
          disabledPresetId: 240,
          reportId: 1,
          availableSlots: [
            {id: 240, name: "BYPASS"},
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 8, name: "Retro"},
            {id: 9, name: "sDamp-1"},
            {id: 10, name: "sDamp-2"},
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
      "FIIO BR15 R2R": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 10,
          disconnectOnSave: false,
          disabledPresetId: 240,
          availableSlots: [
            {id: 240, name: "BYPASS"},
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 8, name: "Retro"},
            {id: 9, name: "sDamp-1"},
            {id: 10, name: "sDamp-2"},
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
      "FIIO FP3": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 1,
          disconnectOnSave: false,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 160, name: "USER1"}
          ]
        }
      },
      "SNOWSKY TINY A": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 3,
          disconnectOnSave: true,
          disabledPresetId: 240,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 160, name: "USER1"},
            {id: 161, name: "USER2"},
            {id: 162, name: "USER3"},
            {id: 240, name: "Close EQ"}
          ]
        }
      },

      "SNOWSKY TINY B": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 3,
          disconnectOnSave: true,
          disabledPresetId: 240,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 160, name: "USER1"},
            {id: 161, name: "USER2"},
            {id: 162, name: "USER3"},
            {id: 240, name: "Close EQ"}
          ]
        }
      },

      "FIIO FG3": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 10,
          disconnectOnSave: false,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 12, name: "Cinema"},
            {id: 13, name: "FPS"},
            {id: 14, name: "MOBA"},
            {id: 15, name: "ACT"},
            {id: 16, name: "MUG"},
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
      "FIIO LS-TC2": {
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 5,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 1,
          disconnectOnSave: true,
          experimental: true,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 160, name: "USER1"}
          ]
        }
      }
    }
  },
  {
    vendorIds: [0x0104, 0x011B, 0x011D, 0x0661, 0x0663, 0x0666, 0x0762, 0x0D8C, 0x2FC6, 0x31B2, 0x3302, 0x34BE, 0x35D8, 0x36A7, 0x373B, 0x60C1, 0x60E1, 0xB445, 0xB44D], // multiple Walkplay vendorIds
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
      supportsLSFilter: false,
      supportsHSFilter: false,
      supportsLPHPFilters: false,
      autoGlobalGain: false,
      experimental: false,
      availableSlots: [{id: 101, name: "Custom"}]
    },
    deviceGroups: {
      "SchemeNo11": {
        productIds: [0x0004, 0x00C0, 0x0104, 0x0880, 0x1230, 0x1231, 0x1233, 0x1237, 0x123F, 0x1240, 0x1241, 0x1243, 0x1244, 0x1245, 0x1248, 0x1249, 0x124A, 0x124B, 0x124C, 0x124D, 0x124E, 0x1251, 0x1261, 0x1262, 0x1264, 0x1266, 0x1269, 0x126A, 0x126B, 0x126C, 0x126D, 0x126E, 0x126F, 0x1272, 0x1278, 0x127A, 0x127D, 0x127E, 0x1281, 0x1282, 0x1283, 0x1284, 0x1285, 0x1286, 0x1287, 0x1288, 0x1289, 0x128A, 0x128B, 0x128C, 0x128D, 0x128E, 0x128F, 0x1292, 0x1293, 0x1294, 0x1295, 0x1296, 0x1297, 0x1298, 0x1299, 0x129A, 0x129B, 0x129C, 0x129D, 0x129F, 0x12B3, 0x12C0, 0x12C1, 0x12C3, 0x12C4, 0x12C5, 0x12C6, 0x12C8, 0x12C9, 0x12CA, 0x12CB, 0x12CC, 0x12CD, 0x12CE, 0x12DB, 0x12E9, 0x132B, 0x13A3, 0x13A4, 0x13A5, 0x13AB, 0x13C0, 0x13C1, 0x13D3, 0x13D4, 0x13D7, 0x13D9, 0x13DC, 0x3302, 0x4302, 0x43C1, 0x43C3, 0x43D1, 0x43D5, 0x43DC, 0x43E7, 0x51C0, 0x60D2, 0x9121, 0x9123, 0x9124, 0x9125, 0x93C0, 0x93C1, 0x93D1, 0x98C0, 0x98C1, 0x98C2, 0x98D1, 0x98D2, 0x98D5, 0xA862, 0xC204, 0xC207, 0xC208, 0xC209, 0xC20A, 0xC20E, 0xC20F, 0xC211, 0xC212, 0xC213, 0xC214, 0xC215, 0xC217, 0xF806, 0xF807, 0xFF01],
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: false,
          supportsLPHPFilters: true,
          supportsPregain: true
        }
      },
      "SchemeNo16": {
        productIds: [0x011D, 0x4301, 0x4302, 0x4304, 0x4305, 0x4306, 0x430D, 0x430E, 0x430F, 0x4312, 0x4313, 0x4316, 0x4319, 0x4351, 0x4352, 0x4355, 0x4358, 0x4359, 0x435A, 0x435C, 0x435D, 0x435E, 0x4360, 0x4361, 0x4363, 0x4364, 0x4366, 0x4367, 0x4380, 0x4381, 0x4382, 0x4383, 0x4386, 0x43B1, 0x43B6, 0x43B7, 0x43B8, 0x43BC, 0x43BE, 0x43BF, 0x43C0, 0x43C2, 0x43C5, 0x43C6, 0x43C7, 0x43C8, 0x43C9, 0x43CA, 0x43CC, 0x43CD, 0x43CF, 0x43D7, 0x43D8, 0x43DA, 0x43DB, 0x43DE, 0x43E1, 0x43E4, 0x43E6, 0x43E8, 0x43EC, 0x43EF, 0x98D4, 0xEE10, 0xEE20, 0xF808],
        modelConfig: {
          schemeNo: 16,
          maxFilters: 10,
          minGain: -10,
          maxGain: 10,
          autoGlobalGain: false,
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "SchemeNo15": {
        productIds: [0x012A, 0x35D8, 0x39C1, 0x4353, 0x4357, 0x4362, 0x4370, 0x43CB, 0x43D6, 0x43D9, 0x43DF, 0x43E2, 0x43E3, 0x43EA, 0x43EB],
        modelConfig: {
          schemeNo: 15,
          maxFilters: 8,
          minGain: -12,
          maxGain: 12,
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "SchemeNo13": {
        productIds: [0x011B, 0x0123, 0x120C, 0x1320, 0x1321, 0x1326, 0x1327, 0x1328, 0x1329, 0x132A, 0x1333, 0x13A9, 0x13AC, 0x13AE, 0x13AF, 0x13B0, 0x13B1, 0x13B2, 0x13B4, 0x13B6, 0x13B9, 0x13BA, 0x13BB, 0x13BE, 0x13BF, 0x13DF, 0x23C0, 0x23C1, 0x60C0, 0x60C1, 0x60C3, 0x60D1, 0x60E1],
        modelConfig: {
          schemeNo: 13,
          maxFilters: 10,
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "SchemeNo17": {
        productIds: [0x2010, 0x201D, 0x201E, 0x2030, 0x2036, 0x2038, 0x203A, 0x20E1, 0x20E2, 0x20E3, 0x20E5, 0x20E7, 0x20E8, 0x20EA, 0x20EC, 0x20EE, 0x20EF, 0x20FF, 0x2DC1],
        modelConfig: {
          schemeNo: 17,
          maxFilters: 5, // Per scratch 116
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "SchemeNo18": {
        productIds: [0x39C2, 0x39C4, 0x39C6, 0x39C7, 0x39C9, 0x39CD, 0x44D1, 0x44D2, 0x44D3, 0x44D6],
        modelConfig: {
          schemeNo: 18,
          maxFilters: 10,
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "SchemeNo10": {
        productIds: [0x0881, 0x0888],
        modelConfig: {
          schemeNo: 10,
          maxFilters: 8,
          supportsLSFilter: false,
          supportsHSFilter: false,
          supportsPregain: true
        }
      },
      "SchemeNo19": {
        productIds: [0x231E, 0x231F, 0x2320, 0x2323, 0x23E2, 0x23EE],
        modelConfig: {
          schemeNo: 19,
          maxFilters: 6,
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "SchemeNo20": {
        productIds: [0x0883, 0x1323, 0x13B7],
        modelConfig: {
          schemeNo: 20,
          maxFilters: 10,
          supportsLSFilter: false,
          supportsHSFilter: false,
          supportsPregain: true
        }
      },
      "SchemeNo21": {
        productIds: [0x0880, 0x08F2, 0x13F2, 0x3DC1, 0x3DC4, 0x3DC5, 0x3DC6, 0x3DC7],
        modelConfig: {
          schemeNo: 21,
          maxFilters: 8,
          supportsLSFilter: false,
          supportsHSFilter: false,
          supportsPregain: true
        }
      }
    },
    devices: {
      "Old Fashioned": {
        manufacturer: "Moondrop",
        handler: moondropOldFashionedUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 3,      // Limited range: -12.8 to +12.7 technically, but app shows -12 to +3
          maxFilters: 5,
          firstWritableEQSlot: -1,
          maxWritableEQSlots: 0,
          disconnectOnSave: false,
          disabledPresetId: -1,
          experimental: false,
          supportsLSFilter: false,
          supportsHSFilter: false,  // Only peaking filters supported
          supportsPregain: false,
          defaultResetFiltersValues: [{gain: 0, freq: 100, q: 1, filterType: "PK"}],
          availableSlots: [{id: 0, name: "Custom"}]
        }
      },
      "FIIO FX17": {
        manufacturer: "FiiO",
        handler: fiioUsbHID,
        modelConfig: {
          minGain: -12,
          maxGain: 12,
          maxFilters: 10,
          firstWritableEQSlot: 160,
          maxWritableEQSlots: 1,
          disconnectOnSave: false,
          disabledPresetId: -1,
          experimental: false,
          availableSlots: [
            {id: 0, name: "Jazz"},
            {id: 1, name: "Pop"},
            {id: 2, name: "Rock"},
            {id: 3, name: "Dance"},
            {id: 4, name: "R&B"},
            {id: 5, name: "Classic"},
            {id: 6, name: "Hip-hop"},
            {id: 160, name: "USER1"}
          ]
        }
      },
      "Rays": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true,
        }
      },
      "Marigold": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSFilter: false,
          supportsHSFilter: false,
          supportsPregain: true,
        }
      },
      "FreeDSP Pro": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true,
        }
      },
      "MOONRIVER 3": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: false,  // Version dependent - needs firmware check
        }
      },
      "FreeDSP Mini": {
        manufacturer: "Moondrop",
        handler: moondropUsbHidHandler,
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: true,
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
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
        }
      },
      "CS43198 HiFi DSP Audio": {
        manufacturer: "Walkplay",
        handler: walkplayUsbHID,
        modelConfig: {
          schemeNo: 11,
          maxFilters: 8,
          minGain: -10,
          maxGain: 10,
          autoGlobalGain: true,
          supportsLSFilter: true,
          supportsHSFilter: true,
          supportsPregain: true
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
          supportsLSFilter: false,
          supportsHSFilter: false
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
      supportsLSFilter: true,
      supportsHSFilter: true,
      defaultResetFiltersValues:[{gain:0, freq: 100, q:1, filterType: "PK"}],
      availableSlots: [{id: 0x03, name: "Custom"}]
    },
    devices: {
      "Kiwi Ears-Allegro PRO": {
        manufacturer: "Kiwi Ears",
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: true,
          disconnectOnSave: true,
          baseRegisterOffset: 0x26
        }
      },
      "Kiwi Ears Allegro Mini": {
        manufacturer: "Kiwi Ears",
        modelConfig: {
          supportsLSFilter: true,
          supportsHSFilter: true,
          disconnectOnSave: true,
          baseRegisterOffset: 0x35
        }
      },
      "KT02H20 HIFI Audio": {
        manufacturer: "JCally",
        modelConfig: {
          supportsLSFilter: false,
          supportsHSFilter: false,
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
    vendorIds: [0x152A], // 5418 in decimal = 0x152A in hex (shared with Topping)
    manufacturer: "Fosi Audio",
    handler: fosiAudioUsbHID,
    defaultModelConfig: {
      minGain: -12,
      maxGain: 12,
      maxFilters: 10,
      firstWritableEQSlot: 7,
      maxWritableEQSlots: 5,
      disconnectOnSave: false,
      disabledPresetId: 0,
      experimental: true,
      supportsPregain: false,
      supportsLSFilter: true,
      supportsHSFilter: true,
      defaultResetFiltersValues:[{gain:0, freq: 100, q:1, filterType: "PK"}],
      reportId: 1,
      availableSlots: [
        {id: 0, name: "Bypass"},
        {id: 7, name: "Custom 1"},
        {id: 8, name: "Custom 2"},
        {id: 9, name: "Custom 3"},
        {id: 10, name: "Custom 4"},
        {id: 11, name: "Custom 5"}
      ]
    },
    devices: {
      "Fosi Audio DS3": {
        modelConfig: {
          maxFilters: 10,
          disconnectOnSave: false,
          firstWritableEQSlot: 7,
          maxWritableEQSlots: 5,
          experimental: false,
          availableSlots: [
            {id: 0, name: "Bypass"},
            {id: 7, name: "Custom 1"},
            {id: 8, name: "Custom 2"},
            {id: 9, name: "Custom 3"},
            {id: 10, name: "Custom 4"},
            {id: 11, name: "Custom 5"}
          ]
        }
      }
    }
  }
])
