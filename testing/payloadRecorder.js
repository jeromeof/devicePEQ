// payloadRecorder.js
// Capture real device interactions for regression testing

import { mockDeviceDB } from './mockDeviceDatabase.js';

export class PayloadRecorder {
  constructor() {
    this.isRecording = false;
    this.currentSession = null;
    this.recordedSessions = [];
    this.originalSendReport = null;
    this.originalSendFeatureReport = null;
    this.originalAddEventListener = null;
  }

  // Start recording device interactions
  startRecording(deviceInfo) {
    if (this.isRecording) {
      throw new Error('Already recording a session');
    }

    this.currentSession = {
      deviceInfo,
      startTime: Date.now(),
      interactions: [],
      metadata: {
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        deviceName: deviceInfo.productName || 'Unknown Device',
        vendorId: deviceInfo.vendorId,
        productId: deviceInfo.productId
      }
    };

    this.isRecording = true;
    this.patchDeviceMethods(deviceInfo.device);
    
    console.log('🔴 Started recording device interactions for:', deviceInfo.productName);
  }

  // Stop recording and return captured data
  stopRecording() {
    if (!this.isRecording) {
      throw new Error('No recording session active');
    }

    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
    
    this.restoreOriginalMethods();
    this.recordedSessions.push(this.currentSession);
    
    const session = this.currentSession;
    this.currentSession = null;
    this.isRecording = false;
    
    console.log('⏹️ Stopped recording. Captured', session.interactions.length, 'interactions');
    
    return session;
  }

  // Patch device methods to intercept communications
  patchDeviceMethods(device) {
    if (!device) return;

    // Patch sendReport for HID devices
    if (device.sendReport) {
      this.originalSendReport = device.sendReport.bind(device);
      device.sendReport = async (reportId, data) => {
        this.recordInteraction('sendReport', { reportId, data: new Uint8Array(data) });
        return await this.originalSendReport(reportId, data);
      };
    }

    // Patch sendFeatureReport for HID devices
    if (device.sendFeatureReport) {
      this.originalSendFeatureReport = device.sendFeatureReport.bind(device);
      device.sendFeatureReport = async (reportId, data) => {
        this.recordInteraction('sendFeatureReport', { reportId, data: new Uint8Array(data) });
        return await this.originalSendFeatureReport(reportId, data);
      };
    }

    // Patch addEventListener to capture input reports
    if (device.addEventListener) {
      this.originalAddEventListener = device.addEventListener.bind(device);
      device.addEventListener = (event, handler, options) => {
        if (event === 'inputreport') {
          const wrappedHandler = (e) => {
            this.recordInteraction('inputreport', {
              reportId: e.reportId,
              data: new Uint8Array(e.data.buffer)
            });
            return handler(e);
          };
          return this.originalAddEventListener(event, wrappedHandler, options);
        }
        return this.originalAddEventListener(event, handler, options);
      };
    }

    // Patch for serial devices
    if (device.readable && device.writable) {
      this.patchSerialDevice(device);
    }
  }

  // Patch serial device streams
  patchSerialDevice(device) {
    // Patch the writable stream
    if (device.writable && device.writable.getWriter) {
      const originalGetWriter = device.writable.getWriter.bind(device.writable);
      device.writable.getWriter = () => {
        const writer = originalGetWriter();
        const originalWrite = writer.write.bind(writer);
        
        writer.write = async (data) => {
          const decoder = new TextDecoder();
          const command = decoder.decode(data);
          this.recordInteraction('serialWrite', { command });
          return await originalWrite(data);
        };
        
        return writer;
      };
    }

    // Patch the readable stream
    if (device.readable && device.readable.getReader) {
      const originalGetReader = device.readable.getReader.bind(device.readable);
      device.readable.getReader = () => {
        const reader = originalGetReader();
        const originalRead = reader.read.bind(reader);
        
        reader.read = async () => {
          const result = await originalRead();
          if (result.value) {
            const decoder = new TextDecoder();
            const response = decoder.decode(result.value);
            this.recordInteraction('serialRead', { response });
          }
          return result;
        };
        
        return reader;
      };
    }
  }

  // Record an interaction
  recordInteraction(type, data) {
    if (!this.isRecording || !this.currentSession) return;

    const interaction = {
      type,
      timestamp: Date.now() - this.currentSession.startTime, // Relative timestamp
      data: this.serializeData(data)
    };

    this.currentSession.interactions.push(interaction);
    
    console.log(`📝 Recorded ${type}:`, this.formatDataForLog(data));
  }

  // Serialize data for storage
  serializeData(data) {
    const serialized = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (value instanceof Uint8Array) {
        serialized[key] = Array.from(value);
      } else {
        serialized[key] = value;
      }
    }
    
    return serialized;
  }

  // Format data for console logging
  formatDataForLog(data) {
    const formatted = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (value instanceof Uint8Array) {
        formatted[key] = Array.from(value).map(b => 
          b.toString(16).padStart(2, '0')
        ).join(' ');
      } else {
        formatted[key] = value;
      }
    }
    
    return formatted;
  }

  // Restore original device methods
  restoreOriginalMethods() {
    // This would need references to the original device object
    // In practice, you might want to track the patched device
  }

  // Export recorded session for use in tests
  exportSession(session) {
    return JSON.stringify(session, null, 2);
  }

  // Import session from JSON
  importSession(jsonData) {
    const session = JSON.parse(jsonData);
    
    // Deserialize Uint8Array data
    session.interactions.forEach(interaction => {
      if (interaction.data) {
        for (const [key, value] of Object.entries(interaction.data)) {
          if (Array.isArray(value) && key === 'data') {
            interaction.data[key] = new Uint8Array(value);
          }
        }
      }
    });
    
    return session;
  }

  // Convert recorded session to mock device profile
  generateMockProfile(session, deviceId) {
    const profile = {
      vendorId: session.metadata.vendorId,
      productId: session.metadata.productId,
      productName: session.metadata.deviceName,
      manufacturer: session.deviceInfo.manufacturer || 'Unknown',
      handler: session.deviceInfo.handler || 'unknown',
      
      // Extract HID descriptor info from interactions
      collections: this.extractHIDCollections(session),
      
      // Generate interactions map from recorded data
      interactions: this.generateInteractionsMap(session),
      
      // Add metadata
      recordingMetadata: {
        recordedAt: session.metadata.timestamp,
        duration: session.duration,
        interactionCount: session.interactions.length
      }
    };

    return profile;
  }

  // Extract HID collections from recorded interactions
  extractHIDCollections(session) {
    const reportIds = new Set();
    
    // Collect all report IDs used
    session.interactions.forEach(interaction => {
      if (interaction.data.reportId !== undefined) {
        reportIds.add(interaction.data.reportId);
      }
    });

    // Generate basic HID collection structure
    if (reportIds.size > 0) {
      const outputReports = [];
      const inputReports = [];
      
      reportIds.forEach(id => {
        outputReports.push({ reportId: id, items: [{ reportCount: 64 }] });
        inputReports.push({ reportId: id, items: [{ reportCount: 64 }] });
      });

      return [{
        usagePage: 0xFF00,
        usage: 0x01,
        featureReports: [],
        inputReports,
        outputReports
      }];
    }

    return [];
  }

  // Generate interactions map from recorded session
  generateInteractionsMap(session) {
    const interactions = {};
    
    // Group interactions by patterns
    const commandMap = new Map();
    
    session.interactions.forEach((interaction, index) => {
      if (interaction.type === 'sendReport' || interaction.type === 'sendFeatureReport') {
        // Look for corresponding response
        const response = this.findResponse(session.interactions, index);
        
        const commandKey = this.generateCommandKey(interaction);
        if (response) {
          commandMap.set(commandKey, {
            request: interaction.data.data,
            response: response.data.data
          });
        }
      }
    });

    // Convert to interactions object
    let counter = 0;
    for (const [key, value] of commandMap) {
      interactions[`command_${counter++}`] = value;
    }

    return interactions;
  }

  // Find response for a given command
  findResponse(interactions, commandIndex) {
    // Look for inputreport within next few interactions
    for (let i = commandIndex + 1; i < Math.min(commandIndex + 5, interactions.length); i++) {
      const interaction = interactions[i];
      if (interaction.type === 'inputreport') {
        return interaction;
      }
    }
    return null;
  }

  // Generate a key to identify command patterns
  generateCommandKey(interaction) {
    if (interaction.data.data && interaction.data.data.length >= 2) {
      // Use first 2 bytes as command identifier
      return `${interaction.data.data[0].toString(16)}_${interaction.data.data[1].toString(16)}`;
    }
    return 'unknown';
  }

  // Create test scenarios from recorded session
  generateTestScenarios(session) {
    const scenarios = [];
    
    // Analyze interaction patterns
    const patterns = this.analyzeInteractionPatterns(session);
    
    patterns.forEach((pattern, index) => {
      scenarios.push({
        name: `Recorded Scenario ${index + 1}`,
        description: `Replays recorded interaction pattern: ${pattern.type}`,
        interactions: pattern.interactions,
        expectedBehavior: pattern.expectedBehavior
      });
    });

    return scenarios;
  }

  // Analyze interaction patterns to identify common sequences
  analyzeInteractionPatterns(session) {
    const patterns = [];
    
    // Simple pattern: command followed by response
    for (let i = 0; i < session.interactions.length - 1; i++) {
      const current = session.interactions[i];
      const next = session.interactions[i + 1];
      
      if ((current.type === 'sendReport' || current.type === 'sendFeatureReport') &&
          next.type === 'inputreport') {
        
        patterns.push({
          type: 'command_response',
          interactions: [current, next],
          expectedBehavior: 'Should receive expected response to command'
        });
      }
    }

    return patterns;
  }

  // Get all recorded sessions
  getRecordedSessions() {
    return this.recordedSessions;
  }

  // Clear all recorded sessions
  clearSessions() {
    this.recordedSessions = [];
  }

  // Update mock device database with recorded profiles
  updateMockDatabase(session, deviceId) {
    const profile = this.generateMockProfile(session, deviceId);
    mockDeviceDB.addDevice(deviceId, profile);
    
    console.log(`✅ Added recorded profile for ${deviceId} to mock database`);
    return profile;
  }
}

// Utility class for payload analysis
export class PayloadAnalyzer {
  static analyzePayloadPattern(payloads) {
    const analysis = {
      commonBytes: [],
      variableBytes: [],
      possibleCommands: [],
      statistics: {}
    };

    if (payloads.length === 0) return analysis;

    const maxLength = Math.max(...payloads.map(p => p.length));
    
    // Find common bytes across all payloads
    for (let pos = 0; pos < maxLength; pos++) {
      const bytesAtPosition = payloads
        .filter(p => p.length > pos)
        .map(p => p[pos]);
      
      const uniqueBytes = [...new Set(bytesAtPosition)];
      
      if (uniqueBytes.length === 1) {
        analysis.commonBytes.push({ position: pos, value: uniqueBytes[0] });
      } else {
        analysis.variableBytes.push({ 
          position: pos, 
          values: uniqueBytes,
          frequency: this.calculateByteFrequency(bytesAtPosition)
        });
      }
    }

    // Identify possible command patterns
    analysis.possibleCommands = this.identifyCommandPatterns(payloads);
    
    // Calculate statistics
    analysis.statistics = {
      totalPayloads: payloads.length,
      averageLength: payloads.reduce((sum, p) => sum + p.length, 0) / payloads.length,
      minLength: Math.min(...payloads.map(p => p.length)),
      maxLength: maxLength,
      commonByteCount: analysis.commonBytes.length,
      variableByteCount: analysis.variableBytes.length
    };

    return analysis;
  }

  static calculateByteFrequency(bytes) {
    const frequency = {};
    bytes.forEach(byte => {
      frequency[byte] = (frequency[byte] || 0) + 1;
    });
    return frequency;
  }

  static identifyCommandPatterns(payloads) {
    const patterns = [];
    
    // Look for common 2-byte command patterns at the start
    const firstTwoBytes = payloads
      .filter(p => p.length >= 2)
      .map(p => `${p[0].toString(16).padStart(2, '0')}${p[1].toString(16).padStart(2, '0')}`);
    
    const commandFrequency = this.calculateByteFrequency(firstTwoBytes);
    
    Object.entries(commandFrequency).forEach(([command, count]) => {
      patterns.push({
        pattern: command,
        frequency: count,
        percentage: (count / payloads.length) * 100
      });
    });

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  // Compare two payloads and highlight differences
  static comparePayloads(payload1, payload2) {
    const maxLength = Math.max(payload1.length, payload2.length);
    const differences = [];
    
    for (let i = 0; i < maxLength; i++) {
      const byte1 = i < payload1.length ? payload1[i] : null;
      const byte2 = i < payload2.length ? payload2[i] : null;
      
      if (byte1 !== byte2) {
        differences.push({
          position: i,
          payload1: byte1,
          payload2: byte2
        });
      }
    }
    
    return differences;
  }
}

// Export singleton instance
export const payloadRecorder = new PayloadRecorder();