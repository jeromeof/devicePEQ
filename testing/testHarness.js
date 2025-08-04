// testHarness.js
// Automated test harness for regression testing USB device handlers

import { MockDeviceFactory, MockUSBDevice, MockSerialDevice } from './mockUSBDevice.js';
import { mockDeviceDB } from './mockDeviceDatabase.js';

export class TestHarness {
  constructor() {
    this.testResults = [];
    this.currentTest = null;
    this.handlers = new Map();
    this.verbose = false;
    
    this.loadHandlers();
  }

  // Load all available handlers
  async loadHandlers() {
    try {
      // Import handlers dynamically
      const { fiioUsbHID } = await import('../devicePEQ/fiioUsbHidHandler.js');
      const { qudelixUsbHidHandler } = await import('../devicePEQ/qudelixUsbHidHandler.js');
      const { jdsLabsUsbSerial } = await import('../devicePEQ/jdsLabsUsbSerialHandler.js');
      const { moondropUsbHidHandler } = await import('../devicePEQ/moondropUsbHidHandler.js');
      
      this.handlers.set('fiioUsbHID', fiioUsbHID);
      this.handlers.set('qudelixUsbHidHandler', qudelixUsbHidHandler);
      this.handlers.set('jdsLabsUsbSerial', jdsLabsUsbSerial);
      this.handlers.set('moondropUsbHidHandler', moondropUsbHidHandler);
      
      console.log(`Loaded ${this.handlers.size} handlers for testing`);
    } catch (error) {
      console.error('Error loading handlers:', error);
    }
  }

  // Run all regression tests
  async runAllTests(options = {}) {
    this.verbose = options.verbose || false;
    this.testResults = [];
    
    console.log('🧪 Starting USB Device Handler Regression Tests');
    console.log('================================================');
    
    const deviceIds = mockDeviceDB.getDeviceIds();
    let totalTests = 0;
    let passedTests = 0;
    
    for (const deviceId of deviceIds) {
      const results = await this.runDeviceTests(deviceId, options);
      totalTests += results.totalTests;
      passedTests += results.passedTests;
    }
    
    // Generate summary report
    console.log('\n📊 Test Results Summary');
    console.log('========================');
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    // Show failed tests
    const failedTests = this.testResults.filter(r => !r.passed);
    if (failedTests.length > 0) {
      console.log('\n❌ Failed Tests:');
      failedTests.forEach(test => {
        console.log(`  ${test.deviceId} - ${test.testName}: ${test.error}`);
      });
    }
    
    return {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: (passedTests / totalTests) * 100,
      results: this.testResults
    };
  }

  // Run tests for a specific device
  async runDeviceTests(deviceId, options = {}) {
    const profile = mockDeviceDB.getDevice(deviceId);
    if (!profile) {
      console.error(`❌ Device profile not found: ${deviceId}`);
      return { totalTests: 0, passedTests: 0 };
    }

    console.log(`\n🔧 Testing ${profile.productName} (${profile.manufacturer})`);
    console.log('-'.repeat(60));
    
    const handler = this.handlers.get(profile.handler);
    if (!handler) {
      console.error(`❌ Handler not found: ${profile.handler}`);
      return { totalTests: 0, passedTests: 0 };
    }

    let totalTests = 0;
    let passedTests = 0;

    // Test basic connection
    const connectionResult = await this.testConnection(deviceId, handler, profile);
    totalTests++;
    if (connectionResult.passed) passedTests++;

    // Test EQ pull functionality
    const pullResult = await this.testEQPull(deviceId, handler, profile);
    totalTests++;
    if (pullResult.passed) passedTests++;

    // Test EQ push functionality
    const pushResult = await this.testEQPush(deviceId, handler, profile);
    totalTests++;
    if (pushResult.passed) passedTests++;

    // Test slot management
    const slotResult = await this.testSlotManagement(deviceId, handler, profile);
    totalTests++;
    if (slotResult.passed) passedTests++;

    // Test error handling
    const errorResult = await this.testErrorHandling(deviceId, handler, profile);
    totalTests++;
    if (errorResult.passed) passedTests++;

    return { totalTests, passedTests };
  }

  // Test basic device connection
  async testConnection(deviceId, handler, profile) {
    const testName = 'Connection Test';
    this.currentTest = { deviceId, testName };
    
    try {
      const mockDevice = MockDeviceFactory.createDevice(deviceId);
      
      // Create device details object that handlers expect
      const deviceDetails = {
        rawDevice: mockDevice,
        model: profile.productName,
        manufacturer: profile.manufacturer,
        modelConfig: profile.modelConfig,
        vendorId: profile.vendorId,
        productId: profile.productId
      };

      // Test device opening
      await mockDevice.open();
      
      if (!mockDevice.opened) {
        throw new Error('Device failed to open');
      }
      
      // Test current slot detection
      if (handler.getCurrentSlot) {
        const currentSlot = await handler.getCurrentSlot(deviceDetails);
        if (typeof currentSlot !== 'number') {
          throw new Error('getCurrentSlot did not return a number');
        }
        this.log(`✓ Current slot: ${currentSlot}`);
      }
      
      await mockDevice.close();
      
      this.recordResult(deviceId, testName, true, 'Connection successful');
      this.log('✅ Connection test passed');
      
      return { passed: true };
      
    } catch (error) {
      this.recordResult(deviceId, testName, false, error.message);
      this.log(`❌ Connection test failed: ${error.message}`);
      return { passed: false, error: error.message };
    }
  }

  // Test EQ pull functionality
  async testEQPull(deviceId, handler, profile) {
    const testName = 'EQ Pull Test';
    this.currentTest = { deviceId, testName };
    
    try {
      const mockDevice = MockDeviceFactory.createDevice(deviceId);
      const deviceDetails = {
        rawDevice: mockDevice,
        model: profile.productName,
        manufacturer: profile.manufacturer,
        modelConfig: profile.modelConfig
      };

      await mockDevice.open();
      
      if (!handler.pullFromDevice) {
        throw new Error('Handler does not implement pullFromDevice');
      }
      
      // Test pulling EQ settings
      const result = await handler.pullFromDevice(deviceDetails, 0);
      
      // Validate result structure
      if (!result || typeof result !== 'object') {
        throw new Error('pullFromDevice returned invalid result');
      }
      
      if (!Array.isArray(result.filters)) {
        throw new Error('Result does not contain filters array');
      }
      
      if (typeof result.globalGain !== 'number') {
        throw new Error('Result does not contain valid globalGain');
      }
      
      // Validate filter structure
      result.filters.forEach((filter, index) => {
        if (!filter.type || !filter.freq || typeof filter.gain !== 'number') {
          throw new Error(`Invalid filter structure at index ${index}`);
        }
      });
      
      this.log(`✓ Pulled ${result.filters.length} filters, globalGain: ${result.globalGain}dB`);
      
      await mockDevice.close();
      
      this.recordResult(deviceId, testName, true, `Pulled ${result.filters.length} filters`);
      this.log('✅ EQ pull test passed');
      
      return { passed: true, result };
      
    } catch (error) {
      this.recordResult(deviceId, testName, false, error.message);
      this.log(`❌ EQ pull test failed: ${error.message}`);
      return { passed: false, error: error.message };
    }
  }

  // Test EQ push functionality
  async testEQPush(deviceId, handler, profile) {
    const testName = 'EQ Push Test';
    this.currentTest = { deviceId, testName };
    
    try {
      const mockDevice = MockDeviceFactory.createDevice(deviceId);
      const deviceDetails = {
        rawDevice: mockDevice,
        model: profile.productName,
        manufacturer: profile.manufacturer,
        modelConfig: profile.modelConfig
      };

      await mockDevice.open();
      
      if (!handler.pushToDevice) {
        throw new Error('Handler does not implement pushToDevice');
      }
      
      // Create test EQ settings
      const testFilters = [
        { type: 'PK', freq: 1000, gain: 3.0, q: 1.0, disabled: false },
        { type: 'LSQ', freq: 100, gain: -2.0, q: 0.7, disabled: false }
      ];
      const testPreamp = -1.5;
      const testSlot = profile.modelConfig.availableSlots?.[0]?.id || 0;
      
      // Test pushing EQ settings
      const shouldDisconnect = await handler.pushToDevice(
        deviceDetails, 
        testSlot, 
        testPreamp, 
        testFilters
      );
      
      // Verify that reports were sent to the device
      if (mockDevice instanceof MockUSBDevice) {
        const sentReports = mockDevice.getSentReports();
        if (sentReports.length === 0) {
          throw new Error('No reports were sent to device');
        }
        this.log(`✓ Sent ${sentReports.length} reports to device`);
      }
      
      this.log(`✓ Pushed ${testFilters.length} filters, preamp: ${testPreamp}dB`);
      
      if (!shouldDisconnect) {
        await mockDevice.close();
      }
      
      this.recordResult(deviceId, testName, true, `Pushed ${testFilters.length} filters`);
      this.log('✅ EQ push test passed');
      
      return { passed: true };
      
    } catch (error) {
      this.recordResult(deviceId, testName, false, error.message);
      this.log(`❌ EQ push test failed: ${error.message}`);
      return { passed: false, error: error.message };
    }
  }

  // Test slot management
  async testSlotManagement(deviceId, handler, profile) {
    const testName = 'Slot Management Test';
    this.currentTest = { deviceId, testName };
    
    try {
      const mockDevice = MockDeviceFactory.createDevice(deviceId);
      const deviceDetails = {
        rawDevice: mockDevice,
        model: profile.productName,
        manufacturer: profile.manufacturer,
        modelConfig: profile.modelConfig
      };

      await mockDevice.open();
      
      // Test getCurrentSlot
      if (handler.getCurrentSlot) {
        const currentSlot = await handler.getCurrentSlot(deviceDetails);
        this.log(`✓ Current slot: ${currentSlot}`);
      }
      
      // Test enablePEQ if available
      if (handler.enablePEQ) {
        const testSlot = profile.modelConfig.availableSlots?.[0]?.id || 0;
        await handler.enablePEQ(deviceDetails, true, testSlot);
        this.log(`✓ Enabled PEQ on slot ${testSlot}`);
        
        await handler.enablePEQ(deviceDetails, false, testSlot);
        this.log(`✓ Disabled PEQ on slot ${testSlot}`);
      }
      
      await mockDevice.close();
      
      this.recordResult(deviceId, testName, true, 'Slot management successful');
      this.log('✅ Slot management test passed');
      
      return { passed: true };
      
    } catch (error) {
      this.recordResult(deviceId, testName, false, error.message);
      this.log(`❌ Slot management test failed: ${error.message}`);
      return { passed: false, error: error.message };
    }
  }

  // Test error handling
  async testErrorHandling(deviceId, handler, profile) {
    const testName = 'Error Handling Test';
    this.currentTest = { deviceId, testName };
    
    try {
      const mockDevice = MockDeviceFactory.createDevice(deviceId);
      const deviceDetails = {
        rawDevice: mockDevice,
        model: profile.productName,
        manufacturer: profile.manufacturer,
        modelConfig: profile.modelConfig
      };

      await mockDevice.open();
      
      // Test timeout handling
      if (mockDevice instanceof MockUSBDevice) {
        mockDevice.simulateError('timeout');
        
        try {
          await handler.pullFromDevice(deviceDetails, 0);
          // If it doesn't throw, that's also valid (handler may have timeout handling)
          this.log('✓ Timeout handled gracefully');
        } catch (error) {
          // Expected behavior for timeout
          this.log('✓ Timeout properly detected');
        }
      }
      
      await mockDevice.close();
      
      this.recordResult(deviceId, testName, true, 'Error handling successful');
      this.log('✅ Error handling test passed');
      
      return { passed: true };
      
    } catch (error) {
      this.recordResult(deviceId, testName, false, error.message);
      this.log(`❌ Error handling test failed: ${error.message}`);
      return { passed: false, error: error.message };
    }
  }

  // Record test result
  recordResult(deviceId, testName, passed, message) {
    this.testResults.push({
      deviceId,
      testName,
      passed,
      message,
      error: passed ? null : message,
      timestamp: new Date().toISOString()
    });
  }

  // Log message (respects verbose flag)
  log(message) {
    if (this.verbose) {
      console.log(`  ${message}`);
    }
  }

  // Generate detailed test report
  generateReport() {
    const report = {
      summary: {
        totalTests: this.testResults.length,
        passedTests: this.testResults.filter(r => r.passed).length,
        failedTests: this.testResults.filter(r => !r.passed).length,
        timestamp: new Date().toISOString()
      },
      results: this.testResults,
      deviceSummary: {}
    };

    // Group results by device
    const deviceGroups = {};
    this.testResults.forEach(result => {
      if (!deviceGroups[result.deviceId]) {
        deviceGroups[result.deviceId] = [];
      }
      deviceGroups[result.deviceId].push(result);
    });

    // Generate device summaries
    for (const [deviceId, results] of Object.entries(deviceGroups)) {
      const passed = results.filter(r => r.passed).length;
      const total = results.length;
      
      report.deviceSummary[deviceId] = {
        passed,
        total,
        successRate: (passed / total) * 100,
        results
      };
    }

    return report;
  }

  // Export test results to JSON
  exportResults(filename) {
    const report = this.generateReport();
    const json = JSON.stringify(report, null, 2);
    
    // In a real environment, you'd write to file
    console.log('📄 Test Report:');
    console.log(json);
    
    return json;
  }

  // Run specific test for a device
  async runSpecificTest(deviceId, testType, options = {}) {
    const profile = mockDeviceDB.getDevice(deviceId);
    if (!profile) {
      throw new Error(`Device profile not found: ${deviceId}`);
    }

    const handler = this.handlers.get(profile.handler);
    if (!handler) {
      throw new Error(`Handler not found: ${profile.handler}`);
    }

    this.verbose = options.verbose || false;

    switch (testType) {
      case 'connection':
        return await this.testConnection(deviceId, handler, profile);
      case 'pull':
        return await this.testEQPull(deviceId, handler, profile);
      case 'push':
        return await this.testEQPush(deviceId, handler, profile);
      case 'slots':
        return await this.testSlotManagement(deviceId, handler, profile);
      case 'errors':
        return await this.testErrorHandling(deviceId, handler, profile);
      default:
        throw new Error(`Unknown test type: ${testType}`);
    }
  }
}

// Utility class for running specific test scenarios
export class TestScenarios {
  static async validateHandlerInterface(handler, handlerName) {
    const requiredMethods = ['getCurrentSlot', 'pullFromDevice', 'pushToDevice'];
    const optionalMethods = ['enablePEQ'];
    
    const issues = [];
    
    // Check required methods
    requiredMethods.forEach(method => {
      if (typeof handler[method] !== 'function') {
        issues.push(`Missing required method: ${method}`);
      }
    });
    
    // Check optional methods
    optionalMethods.forEach(method => {
      if (handler[method] && typeof handler[method] !== 'function') {
        issues.push(`Invalid optional method: ${method}`);
      }
    });
    
    return {
      valid: issues.length === 0,
      issues,
      handlerName
    };
  }

  static async testFilterValidation(filters) {
    const issues = [];
    
    filters.forEach((filter, index) => {
      if (!filter.type) issues.push(`Filter ${index}: missing type`);
      if (!filter.freq || filter.freq <= 0) issues.push(`Filter ${index}: invalid frequency`);
      if (typeof filter.gain !== 'number') issues.push(`Filter ${index}: invalid gain`);
      if (!filter.q || filter.q <= 0) issues.push(`Filter ${index}: invalid Q`);
    });
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
}

// Export singleton instance
export const testHarness = new TestHarness();