//
// Copyright 2024 : Pragmatic Audio
//
// Network Device Model Configuration
// Provides a similar structure to usbDeviceConfig.js / usbSerialDeviceConfig.js
// for devices connected over the network (e.g., WiiM and Luxsin X9).
//

export const networkDeviceHandlerConfig = {
  // Defaults applied to all network devices unless overridden per model
  defaultModelConfig: {
    minGain: -12,
    maxGain: 12,
    maxFilters: 10, // Requirement: support up to 10 filters
    firstWritableEQSlot: 0,
    maxWritableEQSlots: 1,
    disconnectOnSave: false,
    disabledPresetId: -1,
    experimental: false,
    supportsLSHSFilters: true, // LHS/HSQ supported
    supportsPregain: true,
    supportedFilterTypes: ["PK", "LSQ", "HSQ"], // Requirement: PK, LSQ, HSQ
  },

  // Known network devices keyed by selection value used in the UI
  devices: {
    // WiiM devices accessed via Linkplay HTTP API over HTTPS
    "WiiM": {
      manufacturer: "WiiM",
      model: "WiiM Network Device",
      // modelConfig overrides if any in the future
      modelConfig: {}
    },

    // Luxsin X9 device, plain HTTP with custom encoded payloads
    "Luxsin": {
      manufacturer: "Luxsin",
      model: "Luxsin X9",
      modelConfig: {}
    }
  }
};
