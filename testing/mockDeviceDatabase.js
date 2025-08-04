// mockDeviceDatabase.js
// Mock device database for regression testing of USB device handlers

export class MockDeviceDatabase {
  constructor() {
    this.devices = new Map();
    this.loadDeviceProfiles();
  }

  // Load all device profiles from the database
  loadDeviceProfiles() {
    // FiiO device profiles
    this.addDevice('fiio_k9_pro', {
      vendorId: 0x2972,
      productId: 0x0047,
      productName: "FiiO K9 Pro",
      manufacturer: "FiiO",
      handler: "fiioUsbHID",
      
      // HID descriptor simulation
      collections: [{
        usagePage: 0xFF00,
        usage: 0x01,
        featureReports: [
          { reportId: 7, items: [{ reportCount: 64 }] }
        ],
        inputReports: [
          { reportId: 8, items: [{ reportCount: 64 }] }
        ],
        outputReports: [
          { reportId: 7, items: [{ reportCount: 64 }] }
        ]
      }],

      // Configuration
      modelConfig: {
        minGain: -12,
        maxGain: 12,
        maxFilters: 5,
        reportId: 7,
        experimental: false,
        supportsLSHSFilters: true,
        supportsPregain: true,
        availableSlots: [
          {id: 160, name: "USER1"},
          {id: 161, name: "USER2"}
        ]
      },

      // Recorded interactions for regression testing
      interactions: {
        // Pull EQ response - typical FiiO response with 5 bands
        pullEQ: {
          request: new Uint8Array([0x01, 0x00, 0x00, 0x00]), // Pull request
          response: new Uint8Array([
            0x01, 0x00, // Command response
            0x0D, 0x00, 0x7D, 0x00, 0x00, 0x00, 0x64, 0x00, // Band 1: PEQ, 125Hz, 0dB, Q=1.0
            0x0D, 0x00, 0xFA, 0x00, 0x32, 0x00, 0x64, 0x00, // Band 2: PEQ, 250Hz, 5dB, Q=1.0
            0x0D, 0x00, 0xF4, 0x01, 0x00, 0x00, 0x64, 0x00, // Band 3: PEQ, 500Hz, 0dB, Q=1.0
            0x0D, 0x00, 0xE8, 0x03, 0xCE, 0xFF, 0x64, 0x00, // Band 4: PEQ, 1000Hz, -5dB, Q=1.0
            0x0D, 0x00, 0xD0, 0x07, 0x00, 0x00, 0x64, 0x00, // Band 5: PEQ, 2000Hz, 0dB, Q=1.0
            0x00, 0x00 // Pre-gain: 0dB
          ])
        },
        
        // Push EQ scenario
        pushEQ: {
          request: new Uint8Array([
            0x02, 0x00, // Set EQ command
            0x0D, 0x00, 0x7D, 0x00, 0x32, 0x00, 0x64, 0x00, // Band 1: PEQ, 125Hz, 5dB, Q=1.0
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Band 2: Bypass
            0x00, 0x00 // Pre-gain: 0dB
          ]),
          response: new Uint8Array([0x02, 0x00, 0x01]) // Success response
        }
      },

      // Test scenarios for comprehensive testing
      testScenarios: [
        {
          name: "Pull empty EQ",
          description: "Device with no EQ filters set",
          mockResponse: "emptyEQ"
        },
        {
          name: "Pull full 5-band EQ",
          description: "Device with all 5 bands configured",
          mockResponse: "fullEQ"
        },
        {
          name: "Push single peaking filter",
          description: "Set one peaking filter at 1kHz",
          mockResponse: "pushSuccess"
        }
      ]
    });

    // JDS Labs Element IV
    this.addDevice('jds_element_iv', {
      vendorId: 0x16C0,
      productId: 0x4321,
      productName: "JDS Labs Element IV",
      manufacturer: "JDS Labs",
      handler: "jdsLabsUsbSerial",
      
      // Serial device simulation (different from HID)
      deviceType: "serial",
      baudRate: 115200,
      
      modelConfig: {
        minGain: -24,
        maxGain: 24,
        maxFilters: 12,
        experimental: false,
        supportsLSHSFilters: true,
        supportsPregain: true
      },

      interactions: {
        describe: {
          request: JSON.stringify({Product: "JDS Labs Element IV", Action: "Describe"}),
          response: JSON.stringify({
            Product: "JDS Labs Element IV",
            Configuration: {
              General: {
                "Input Mode": { Current: "USB" }
              },
              DSP: {
                Headphone: {
                  "Lowshelf 1": { Type: "LOWSHELF", Frequency: 100, Gain: 0, Q: 0.7 },
                  "Peaking 1": { Type: "PEAKING", Frequency: 200, Gain: 2.5, Q: 1.0 },
                  "Peaking 2": { Type: "PEAKING", Frequency: 500, Gain: -1.5, Q: 0.8 },
                  "Highshelf 1": { Type: "HIGHSHELF", Frequency: 8000, Gain: 1.0, Q: 0.7 }
                }
              }
            }
          })
        }
      }
    });

    // Qudelix 5K
    this.addDevice('qudelix_5k', {
      vendorId: 0x2E75,
      productId: 0x0001,
      productName: "Qudelix-5K USB DAC 48KHz",
      manufacturer: "Qudelix",
      handler: "qudelixUsbHidHandler",
      
      collections: [{
        usagePage: 0xFF00,
        usage: 0x01,
        featureReports: [],
        inputReports: [
          { reportId: 2, items: [{ reportCount: 64 }] }, // Response
          { reportId: 9, items: [{ reportCount: 64 }] }  // Device to Host
        ],
        outputReports: [
          { reportId: 7, items: [{ reportCount: 64 }] }, // QX_OUT
          { reportId: 8, items: [{ reportCount: 64 }] }  // QX_HOST_TO_DEVICE
        ]
      }],

      modelConfig: {
        minGain: -12,
        maxGain: 12,
        maxFilters: 10,
        experimental: true,
        supportsLSHSFilters: true,
        supportsPregain: true,
        availableSlots: [
          {id: 101, name: "Custom"},
          {id: 1, name: "Preset 1"}
        ]
      },

      interactions: {
        reqEqPreset: {
          request: new Uint8Array([
            0x04, 0x80, // Length + HID command
            0x00, 0x04, // ReqEqPreset command
            0x01 // Request user preset
          ]),
          response: new Uint8Array([
            0x0C, // Length
            0x80, 0x04, // RspEqPreset command
            0x0D, 0x7D, 0x00, 0x32, 0x00, 0x64, 0x00, // Band 1: PEQ, 125Hz, 5dB, Q=1.0
            0x00, 0x00 // Pre-gain: 0dB
          ])
        }
      }
    });

    // Moondrop devices
    this.addDevice('moondrop_dawn_pro', {
      vendorId: 0x31B2,
      productId: 0x0050,
      productName: "DAWN PRO 2",
      manufacturer: "Moondrop",
      handler: "moondropUsbHidHandler",
      
      collections: [{
        usagePage: 0xFF00,
        usage: 0x01,
        featureReports: [
          { reportId: 1, items: [{ reportCount: 64 }] }
        ],
        inputReports: [
          { reportId: 2, items: [{ reportCount: 64 }] }
        ],
        outputReports: [
          { reportId: 1, items: [{ reportCount: 64 }] }
        ]
      }],

      modelConfig: {
        schemeNo: 15,
        experimental: true,
        maxFilters: 10,
        supportsLSHSFilters: false,
        supportsPregain: true
      },

      interactions: {
        // Moondrop-specific protocol interactions would go here
      }
    });
  }

  // Add a device profile to the database
  addDevice(deviceId, profile) {
    this.devices.set(deviceId, profile);
  }

  // Get device profile by ID
  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  // Get all devices for a manufacturer
  getDevicesByManufacturer(manufacturer) {
    return Array.from(this.devices.values())
      .filter(device => device.manufacturer === manufacturer);
  }

  // Get all devices that use a specific handler
  getDevicesByHandler(handlerName) {
    return Array.from(this.devices.values())
      .filter(device => device.handler === handlerName);
  }

  // Get all device IDs
  getDeviceIds() {
    return Array.from(this.devices.keys());
  }

  // Export device database for persistence
  exportDatabase() {
    const exported = {};
    for (const [id, profile] of this.devices) {
      exported[id] = {
        ...profile,
        // Convert Uint8Arrays to regular arrays for JSON serialization
        interactions: this.serializeInteractions(profile.interactions)
      };
    }
    return JSON.stringify(exported, null, 2);
  }

  // Serialize Uint8Array data for JSON export
  serializeInteractions(interactions) {
    if (!interactions) return {};
    
    const serialized = {};
    for (const [key, interaction] of Object.entries(interactions)) {
      serialized[key] = {
        request: interaction.request instanceof Uint8Array ? 
          Array.from(interaction.request) : interaction.request,
        response: interaction.response instanceof Uint8Array ? 
          Array.from(interaction.response) : interaction.response
      };
    }
    return serialized;
  }

  // Import device database from JSON
  importDatabase(jsonData) {
    const imported = JSON.parse(jsonData);
    
    for (const [id, profile] of Object.entries(imported)) {
      // Convert arrays back to Uint8Arrays
      if (profile.interactions) {
        profile.interactions = this.deserializeInteractions(profile.interactions);
      }
      this.addDevice(id, profile);
    }
  }

  // Deserialize interactions back to Uint8Arrays
  deserializeInteractions(interactions) {
    const deserialized = {};
    for (const [key, interaction] of Object.entries(interactions)) {
      deserialized[key] = {
        request: Array.isArray(interaction.request) ? 
          new Uint8Array(interaction.request) : interaction.request,
        response: Array.isArray(interaction.response) ? 
          new Uint8Array(interaction.response) : interaction.response
      };
    }
    return deserialized;
  }
}

// Singleton instance
export const mockDeviceDB = new MockDeviceDatabase();