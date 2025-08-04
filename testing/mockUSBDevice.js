// mockUSBDevice.js
// Mock USB device that simulates WebHID API behavior for testing

import { mockDeviceDB } from './mockDeviceDatabase.js';

export class MockUSBDevice extends EventTarget {
  constructor(deviceProfile) {
    super();
    this.profile = deviceProfile;
    this.opened = false;
    this.collections = deviceProfile.collections || [];
    this.productName = deviceProfile.productName;
    this.vendorId = deviceProfile.vendorId;
    this.productId = deviceProfile.productId;
    
    // Track sent reports for verification
    this.sentReports = [];
    this.sentFeatureReports = [];
    
    // Response queue for simulating async responses
    this.responseQueue = [];
    this.responseDelay = 50; // ms
    
    console.log(`MockUSBDevice created: ${this.productName}`);
  }

  // Simulate opening the device
  async open() {
    if (this.opened) {
      throw new Error('Device already opened');
    }
    
    this.opened = true;
    console.log(`MockUSBDevice opened: ${this.productName}`);
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Simulate closing the device
  async close() {
    if (!this.opened) {
      throw new Error('Device not opened');
    }
    
    this.opened = false;
    console.log(`MockUSBDevice closed: ${this.productName}`);
  }

  // Mock sendReport - simulates HID output reports
  async sendReport(reportId, data) {
    if (!this.opened) {
      throw new Error('Device not opened');
    }

    console.log(`MockUSBDevice sendReport: ID=${reportId}, data=[${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
    
    // Record the sent report
    this.sentReports.push({
      reportId,
      data: new Uint8Array(data),
      timestamp: Date.now()
    });

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Generate appropriate response based on the request
    this.generateResponse(reportId, data);
  }

  // Mock sendFeatureReport - simulates HID feature reports
  async sendFeatureReport(reportId, data) {
    if (!this.opened) {
      throw new Error('Device not opened');
    }

    console.log(`MockUSBDevice sendFeatureReport: ID=${reportId}, data=[${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
    
    // Record the sent feature report
    this.sentFeatureReports.push({
      reportId,
      data: new Uint8Array(data),
      timestamp: Date.now()
    });

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // Mock receiveFeatureReport - simulates reading HID feature reports
  async receiveFeatureReport(reportId) {
    if (!this.opened) {
      throw new Error('Device not opened');
    }

    console.log(`MockUSBDevice receiveFeatureReport: ID=${reportId}`);
    
    // Look up stored response for this report ID
    const response = this.getStoredResponse('featureReport', reportId);
    if (response) {
      return { buffer: response.buffer };
    }
    
    // Return empty response if no stored data
    return { buffer: new ArrayBuffer(64) };
  }

  // Generate response based on the device type and request
  generateResponse(reportId, requestData) {
    const handler = this.profile.handler;
    
    // Route to appropriate response generator based on handler type
    switch (handler) {
      case 'fiioUsbHID':
        this.generateFiioResponse(reportId, requestData);
        break;
      case 'qudelixUsbHidHandler':
        this.generateQudelixResponse(reportId, requestData);
        break;
      case 'moondropUsbHidHandler':
        this.generateMoondropResponse(reportId, requestData);
        break;
      case 'jdsLabsUsbSerial':
        // Serial devices handle responses differently
        break;
      default:
        console.warn(`Unknown handler: ${handler}`);
    }
  }

  // Generate FiiO-specific responses
  generateFiioResponse(reportId, requestData) {
    // FiiO protocol analysis - typically uses report ID 7
    if (reportId === 7 && requestData.length >= 4) {
      const command = (requestData[0] << 8) | requestData[1];
      
      setTimeout(() => {
        let responseData;
        
        switch (command) {
          case 0x0100: // Pull EQ request
            responseData = this.profile.interactions?.pullEQ?.response || 
              this.generateDefaultFiioEQResponse();
            break;
          case 0x0200: // Push EQ request
            responseData = this.profile.interactions?.pushEQ?.response || 
              new Uint8Array([0x02, 0x00, 0x01]); // Success
            break;
          default:
            responseData = new Uint8Array([0xFF, 0xFF, 0x00]); // Unknown command
        }
        
        this.dispatchInputReport(8, responseData); // Response on input report ID 8
      }, this.responseDelay);
    }
  }

  // Generate Qudelix-specific responses
  generateQudelixResponse(reportId, requestData) {
    // Qudelix protocol - uses HID packet format
    if ((reportId === 7 || reportId === 8) && requestData.length >= 3) {
      const len = requestData[0];
      const hidCmd = requestData[1];
      
      if (hidCmd === 0x80) { // HID command
        const appCmd = (requestData[2] << 8) | requestData[3];
        
        setTimeout(() => {
          let responseData;
          
          switch (appCmd) {
            case 0x0004: // ReqEqPreset
              responseData = this.profile.interactions?.reqEqPreset?.response || 
                this.generateDefaultQudelixEQResponse();
              break;
            case 0x0102: // SetEqEnable
              responseData = new Uint8Array([0x03, 0x81, 0x02, 0x01]); // Success
              break;
            default:
              responseData = new Uint8Array([0x03, 0xFF, 0xFF, 0x00]); // Unknown
          }
          
          // Send response on appropriate input report ID
          const responseReportId = this.getQudelixResponseReportId();
          this.dispatchInputReport(responseReportId, responseData);
        }, this.responseDelay);
      }
    }
  }

  // Generate Moondrop-specific responses
  generateMoondropResponse(reportId, requestData) {
    // Moondrop protocol implementation
    if (reportId === 1 && requestData.length >= 2) {
      setTimeout(() => {
        const responseData = new Uint8Array([0x01, 0x00, 0x01]); // Generic success
        this.dispatchInputReport(2, responseData);
      }, this.responseDelay);
    }
  }

  // Get appropriate response report ID for Qudelix
  getQudelixResponseReportId() {
    // Prefer qx_deviceToHost (9), fallback to response (2)
    const hasReportId9 = this.collections.some(c => 
      c.inputReports?.some(r => r.reportId === 9)
    );
    return hasReportId9 ? 9 : 2;
  }

  // Dispatch an input report event (simulates device sending data to host)
  dispatchInputReport(reportId, data) {
    console.log(`MockUSBDevice inputreport: ID=${reportId}, data=[${Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
    
    const event = new CustomEvent('inputreport', {
      detail: {
        reportId,
        data: { buffer: data.buffer }
      }
    });
    
    // Add the properties that the real WebHID API provides
    event.reportId = reportId;
    event.data = { buffer: data.buffer };
    
    this.dispatchEvent(event);
  }

  // Generate default FiiO EQ response (5 bands, typical structure)
  generateDefaultFiioEQResponse() {
    return new Uint8Array([
      0x01, 0x00, // Response command
      // Band 1: PEQ, 100Hz, 0dB, Q=1.0
      0x0D, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64, 0x00,
      // Band 2: Bypass
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // Band 3: Bypass  
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // Band 4: Bypass
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // Band 5: Bypass
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // Pre-gain: 0dB
      0x00, 0x00
    ]);
  }

  // Generate default Qudelix EQ response
  generateDefaultQudelixEQResponse() {
    return new Uint8Array([
      0x0A, // Length
      0x80, 0x04, // RspEqPreset command  
      // Band 1: PEQ, 1000Hz, 0dB, Q=1.0
      0x0D, 0xE8, 0x03, 0x00, 0x00, 0x64, 0x00,
      // Pre-gain: 0dB
      0x00, 0x00
    ]);
  }

  // Get stored response for a specific interaction
  getStoredResponse(type, reportId) {
    // This would look up stored responses from the profile
    // For now, return null to use generated responses
    return null;
  }

  // Get sent reports for verification in tests
  getSentReports() {
    return [...this.sentReports];
  }

  // Get sent feature reports for verification in tests
  getSentFeatureReports() {
    return [...this.sentFeatureReports];
  }

  // Clear report history
  clearReportHistory() {
    this.sentReports = [];
    this.sentFeatureReports = [];
  }

  // Set custom response for specific scenarios
  setCustomResponse(command, responseData, delay = 50) {
    this.customResponses = this.customResponses || {};
    this.customResponses[command] = { responseData, delay };
  }

  // Simulate device errors
  simulateError(errorType = 'disconnect') {
    setTimeout(() => {
      switch (errorType) {
        case 'disconnect':
          this.opened = false;
          this.dispatchEvent(new CustomEvent('disconnect'));
          break;
        case 'timeout':
          // Don't send any response - simulates timeout
          break;
        case 'malformed':
          // Send malformed response
          this.dispatchInputReport(1, new Uint8Array([0xFF, 0xFF]));
          break;
      }
    }, 100);
  }
}

// Mock Serial Device for JDS Labs and similar devices
export class MockSerialDevice {
  constructor(deviceProfile) {
    this.profile = deviceProfile;
    this.opened = false;
    this.readable = new MockReadableStream(this);
    this.writable = new MockWritableStream(this);
    
    // Track communications
    this.sentCommands = [];
    this.responseQueue = [];
  }

  async open(options) {
    this.opened = true;
    console.log(`MockSerialDevice opened: ${this.profile.productName}`);
  }

  async close() {
    this.opened = false;
    console.log(`MockSerialDevice closed: ${this.profile.productName}`);
  }

  // Handle incoming command and generate response
  handleCommand(command) {
    this.sentCommands.push({
      command,
      timestamp: Date.now()
    });

    try {
      const parsedCommand = JSON.parse(command);
      let response;

      if (parsedCommand.Action === "Describe") {
        response = this.profile.interactions?.describe?.response || 
          this.generateDefaultDescribeResponse();
      } else {
        response = JSON.stringify({error: "Unknown command"});
      }

      // Add response to queue with null terminator
      this.responseQueue.push(response + '\0');
      
    } catch (error) {
      console.error('Error parsing command:', error);
      this.responseQueue.push(JSON.stringify({error: "Invalid JSON"}) + '\0');
    }
  }

  generateDefaultDescribeResponse() {
    return JSON.stringify({
      Product: this.profile.productName,
      Configuration: {
        General: {
          "Input Mode": { Current: "USB" }
        },
        DSP: {
          Headphone: {
            "Lowshelf 1": { Type: "LOWSHELF", Frequency: 100, Gain: 0, Q: 0.7 }
          }
        }
      }
    });
  }

  getSentCommands() {
    return [...this.sentCommands];
  }

  clearCommandHistory() {
    this.sentCommands = [];
    this.responseQueue = [];
  }
}

// Mock ReadableStream for serial devices
class MockReadableStream {
  constructor(device) {
    this.device = device;
    this.reader = new MockReader(device);
  }

  getReader() {
    return this.reader;
  }
}

// Mock WritableStream for serial devices  
class MockWritableStream {
  constructor(device) {
    this.device = device;
    this.writer = new MockWriter(device);
  }

  getWriter() {
    return this.writer;
  }
}

// Mock Reader for reading serial responses
class MockReader {
  constructor(device) {
    this.device = device;
  }

  async read() {
    // Simulate reading delay
    await new Promise(resolve => setTimeout(resolve, 10));
    
    if (this.device.responseQueue.length > 0) {
      const response = this.device.responseQueue.shift();
      const encoder = new TextEncoder();
      return {
        value: encoder.encode(response),
        done: false
      };
    }
    
    // Return empty if no response
    return { value: new Uint8Array(0), done: false };
  }
}

// Mock Writer for sending serial commands
class MockWriter {
  constructor(device) {
    this.device = device;
  }

  async write(data) {
    const decoder = new TextDecoder();
    const command = decoder.decode(data).replace(/\0$/, ''); // Remove null terminator
    
    console.log(`MockSerialDevice write: ${command}`);
    this.device.handleCommand(command);
  }
}

// Factory for creating mock devices
export class MockDeviceFactory {
  static createDevice(deviceId) {
    const profile = mockDeviceDB.getDevice(deviceId);
    if (!profile) {
      throw new Error(`Device profile not found: ${deviceId}`);
    }

    if (profile.deviceType === 'serial') {
      return new MockSerialDevice(profile);
    } else {
      return new MockUSBDevice(profile);
    }
  }

  static createDeviceByName(productName) {
    const deviceId = mockDeviceDB.getDeviceIds().find(id => {
      const profile = mockDeviceDB.getDevice(id);
      return profile.productName === productName;
    });

    if (!deviceId) {
      throw new Error(`Device not found: ${productName}`);
    }

    return MockDeviceFactory.createDevice(deviceId);
  }

  static listAvailableDevices() {
    return mockDeviceDB.getDeviceIds().map(id => {
      const profile = mockDeviceDB.getDevice(id);
      return {
        id,
        name: profile.productName,
        manufacturer: profile.manufacturer,
        handler: profile.handler,
        type: profile.deviceType || 'hid'
      };
    });
  }
}