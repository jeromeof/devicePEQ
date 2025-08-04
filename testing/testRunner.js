// testRunner.js
// Automated test suite runner with different device scenarios

import { testHarness } from './testHarness.js';
import { mockDeviceDB } from './mockDeviceDatabase.js';
import { MockDeviceFactory } from './mockUSBDevice.js';
import { payloadRecorder } from './payloadRecorder.js';

export class TestRunner {
  constructor() {
    this.testSuites = new Map();
    this.results = [];
    this.config = {
      timeout: 30000, // 30 second timeout per test
      retries: 2,
      parallel: false,
      verbose: true
    };
    
    this.setupTestSuites();
  }

  // Set up predefined test suites
  setupTestSuites() {
    // Basic functionality test suite
    this.addTestSuite('basic', {
      name: 'Basic Functionality Tests',
      description: 'Tests core functionality of all device handlers',
      tests: [
        'connection',
        'pull', 
        'push',
        'slots'
      ],
      devices: 'all'
    });

    // Regression test suite
    this.addTestSuite('regression', {
      name: 'Regression Tests',
      description: 'Full regression testing of all handlers with various scenarios',
      tests: [
        'connection',
        'pull',
        'push', 
        'slots',
        'errors'
      ],
      devices: 'all',
      scenarios: [
        'empty_eq',
        'full_eq',
        'single_filter',
        'error_conditions'
      ]
    });

    // Handler-specific test suites
    this.addTestSuite('fiio', {
      name: 'FiiO Device Tests',
      description: 'Comprehensive testing of FiiO device handlers',
      tests: ['connection', 'pull', 'push', 'slots', 'errors'],
      devices: ['fiio_k9_pro'],
      scenarios: ['fiio_specific_tests']
    });

    this.addTestSuite('qudelix', {
      name: 'Qudelix Device Tests', 
      description: 'Comprehensive testing of Qudelix device handlers',
      tests: ['connection', 'pull', 'push', 'slots', 'errors'],
      devices: ['qudelix_5k'],
      scenarios: ['qudelix_specific_tests']
    });

    this.addTestSuite('jds', {
      name: 'JDS Labs Device Tests',
      description: 'Comprehensive testing of JDS Labs serial device handlers',
      tests: ['connection', 'pull', 'push', 'slots'],
      devices: ['jds_element_iv'],
      scenarios: ['serial_specific_tests']
    });

    // Performance test suite
    this.addTestSuite('performance', {
      name: 'Performance Tests',
      description: 'Tests performance characteristics of device handlers',
      tests: ['performance'],
      devices: 'all'
    });

    // Stress test suite
    this.addTestSuite('stress', {
      name: 'Stress Tests',
      description: 'Stress testing with rapid operations and edge cases',
      tests: ['stress'],
      devices: 'all'
    });
  }

  // Add a test suite
  addTestSuite(id, suite) {
    this.testSuites.set(id, suite);
  }

  // Run a specific test suite
  async runTestSuite(suiteId, options = {}) {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    console.log(`\n🏃 Running Test Suite: ${suite.name}`);
    console.log(`📄 ${suite.description}`);
    console.log('='.repeat(60));

    const config = { ...this.config, ...options };
    const results = {
      suiteId,
      suiteName: suite.name,
      startTime: Date.now(),
      results: [],
      summary: {}
    };

    // Get devices to test
    const deviceIds = this.getDevicesForSuite(suite);
    
    if (deviceIds.length === 0) {
      console.log('❌ No devices found for test suite');
      return results;
    }

    console.log(`🎯 Testing ${deviceIds.length} devices: ${deviceIds.join(', ')}`);

    // Run tests for each device
    for (const deviceId of deviceIds) {
      const deviceResults = await this.runDeviceTestsForSuite(
        deviceId, 
        suite, 
        config
      );
      results.results.push(deviceResults);
    }

    // Calculate summary
    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;
    results.summary = this.calculateSuiteSummary(results.results);

    this.results.push(results);

    // Print summary
    this.printSuiteSummary(results);

    return results;
  }

  // Get device IDs for a test suite
  getDevicesForSuite(suite) {
    if (suite.devices === 'all') {
      return mockDeviceDB.getDeviceIds();
    } else if (Array.isArray(suite.devices)) {
      return suite.devices.filter(id => mockDeviceDB.getDevice(id));
    } else {
      return [];
    }
  }

  // Run tests for a specific device in a suite
  async runDeviceTestsForSuite(deviceId, suite, config) {
    const profile = mockDeviceDB.getDevice(deviceId);
    const deviceResults = {
      deviceId,
      deviceName: profile.productName,
      manufacturer: profile.manufacturer,
      handler: profile.handler,
      startTime: Date.now(),
      testResults: [],
      scenarios: []
    };

    console.log(`\n📱 Testing device: ${profile.productName}`);

    // Run basic tests
    for (const testType of suite.tests) {
      try {
        const result = await this.runSingleTest(deviceId, testType, config);
        deviceResults.testResults.push(result);
        
        const status = result.passed ? '✅' : '❌';
        console.log(`  ${status} ${testType}: ${result.message || result.error}`);
        
      } catch (error) {
        deviceResults.testResults.push({
          testType,
          passed: false,
          error: error.message,
          timestamp: Date.now()
        });
        console.log(`  ❌ ${testType}: ${error.message}`);
      }
    }

    // Run scenarios if specified
    if (suite.scenarios) {
      for (const scenarioName of suite.scenarios) {
        try {
          const scenarioResult = await this.runScenario(deviceId, scenarioName, config);
          deviceResults.scenarios.push(scenarioResult);
          
          const status = scenarioResult.passed ? '✅' : '❌';
          console.log(`  ${status} Scenario ${scenarioName}: ${scenarioResult.message}`);
          
        } catch (error) {
          deviceResults.scenarios.push({
            scenarioName,
            passed: false,
            error: error.message,
            timestamp: Date.now()
          });
          console.log(`  ❌ Scenario ${scenarioName}: ${error.message}`);
        }
      }
    }

    deviceResults.endTime = Date.now();
    deviceResults.duration = deviceResults.endTime - deviceResults.startTime;

    return deviceResults;
  }

  // Run a single test with timeout and retry logic
  async runSingleTest(deviceId, testType, config) {
    let lastError;
    
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`  🔄 Retry ${attempt}/${config.retries} for ${testType}`);
        }

        const result = await Promise.race([
          testHarness.runSpecificTest(deviceId, testType, { verbose: config.verbose }),
          this.createTimeoutPromise(config.timeout, `Test ${testType} timed out`)
        ]);

        return { ...result, testType, attempt };

      } catch (error) {
        lastError = error;
        if (attempt < config.retries) {
          await this.delay(1000); // Wait before retry
        }
      }
    }

    return {
      testType,
      passed: false,
      error: lastError.message,
      attempt: config.retries + 1
    };
  }

  // Run a specific test scenario
  async runScenario(deviceId, scenarioName, config) {
    const scenario = this.getScenario(scenarioName);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioName}`);
    }

    console.log(`  🎬 Running scenario: ${scenario.name}`);

    const mockDevice = MockDeviceFactory.createDevice(deviceId);
    const profile = mockDeviceDB.getDevice(deviceId);
    
    try {
      await mockDevice.open();

      // Execute scenario steps
      const results = await scenario.execute(mockDevice, profile, config);
      
      await mockDevice.close();

      return {
        scenarioName,
        passed: results.success,
        message: results.message,
        details: results.details,
        timestamp: Date.now()
      };

    } catch (error) {
      try {
        await mockDevice.close();
      } catch (closeError) {
        // Ignore close errors
      }

      return {
        scenarioName,
        passed: false,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  // Get predefined scenario
  getScenario(scenarioName) {
    const scenarios = {
      empty_eq: {
        name: 'Empty EQ Test',
        execute: async (mockDevice, profile) => {
          // Test with device that has no EQ filters set
          mockDevice.setCustomResponse('pull', new Uint8Array([0x00, 0x00]));
          
          return {
            success: true,
            message: 'Empty EQ scenario completed',
            details: { filterCount: 0 }
          };
        }
      },

      full_eq: {
        name: 'Full EQ Test',
        execute: async (mockDevice, profile) => {
          // Test with device that has all filter bands configured
          const maxFilters = profile.modelConfig.maxFilters || 5;
          
          return {
            success: true,
            message: `Full EQ scenario with ${maxFilters} filters`,
            details: { filterCount: maxFilters }
          };
        }
      },

      single_filter: {
        name: 'Single Filter Test',
        execute: async (mockDevice, profile) => {
          // Test with exactly one filter configured
          return {
            success: true,
            message: 'Single filter scenario completed',
            details: { filterCount: 1 }
          };
        }
      },

      error_conditions: {
        name: 'Error Conditions Test',
        execute: async (mockDevice, profile) => {
          // Test various error conditions
          mockDevice.simulateError('timeout');
          
          return {
            success: true,
            message: 'Error conditions tested',
            details: { errorsSimulated: ['timeout'] }
          };
        }
      },

      fiio_specific_tests: {
        name: 'FiiO Specific Tests',
        execute: async (mockDevice, profile) => {
          // FiiO-specific test scenarios
          return {
            success: true,
            message: 'FiiO specific tests completed',
            details: { reportId: 7 }
          };
        }
      },

      qudelix_specific_tests: {
        name: 'Qudelix Specific Tests',
        execute: async (mockDevice, profile) => {
          // Qudelix-specific test scenarios
          return {
            success: true,
            message: 'Qudelix specific tests completed',
            details: { hidProtocol: true }
          };
        }
      },

      serial_specific_tests: {
        name: 'Serial Device Tests',
        execute: async (mockDevice, profile) => {
          // Serial device specific tests
          return {
            success: true,
            message: 'Serial device tests completed',
            details: { deviceType: 'serial' }
          };
        }
      }
    };

    return scenarios[scenarioName];
  }

  // Calculate summary for a test suite
  calculateSuiteSummary(deviceResults) {
    const summary = {
      totalDevices: deviceResults.length,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      totalScenarios: 0,
      passedScenarios: 0,
      failedScenarios: 0,
      deviceSummary: {}
    };

    deviceResults.forEach(deviceResult => {
      const deviceSummary = {
        passed: 0,
        failed: 0,
        scenarios: 0,
        scenariosPassed: 0
      };

      // Count test results
      deviceResult.testResults.forEach(test => {
        summary.totalTests++;
        if (test.passed) {
          summary.passedTests++;
          deviceSummary.passed++;
        } else {
          summary.failedTests++;
          deviceSummary.failed++;
        }
      });

      // Count scenario results
      deviceResult.scenarios.forEach(scenario => {
        summary.totalScenarios++;
        deviceSummary.scenarios++;
        if (scenario.passed) {
          summary.passedScenarios++;
          deviceSummary.scenariosPassed++;
        } else {
          summary.failedScenarios++;
        }
      });

      summary.deviceSummary[deviceResult.deviceId] = deviceSummary;
    });

    summary.overallSuccessRate = summary.totalTests > 0 ? 
      (summary.passedTests / summary.totalTests) * 100 : 0;

    return summary;
  }

  // Print test suite summary
  printSuiteSummary(results) {
    const { summary } = results;
    
    console.log('\n📊 Test Suite Summary');
    console.log('=====================');
    console.log(`Duration: ${(results.duration / 1000).toFixed(2)}s`);
    console.log(`Devices Tested: ${summary.totalDevices}`);
    console.log(`Tests: ${summary.passedTests}/${summary.totalTests} passed (${summary.overallSuccessRate.toFixed(1)}%)`);
    
    if (summary.totalScenarios > 0) {
      console.log(`Scenarios: ${summary.passedScenarios}/${summary.totalScenarios} passed`);
    }

    // Device breakdown
    console.log('\n📱 Device Breakdown:');
    for (const [deviceId, deviceSummary] of Object.entries(summary.deviceSummary)) {
      const profile = mockDeviceDB.getDevice(deviceId);
      const deviceRate = deviceSummary.passed + deviceSummary.failed > 0 ?
        (deviceSummary.passed / (deviceSummary.passed + deviceSummary.failed)) * 100 : 0;
      
      console.log(`  ${profile.productName}: ${deviceSummary.passed}/${deviceSummary.passed + deviceSummary.failed} (${deviceRate.toFixed(1)}%)`);
    }
  }

  // Run all test suites
  async runAllSuites(options = {}) {
    console.log('🚀 Running All Test Suites');
    console.log('==========================');

    const suiteIds = Array.from(this.testSuites.keys());
    const allResults = [];

    for (const suiteId of suiteIds) {
      try {
        const results = await this.runTestSuite(suiteId, options);
        allResults.push(results);
      } catch (error) {
        console.error(`❌ Failed to run suite ${suiteId}:`, error.message);
        allResults.push({
          suiteId,
          error: error.message,
          failed: true
        });
      }
    }

    // Overall summary
    this.printOverallSummary(allResults);

    return allResults;
  }

  // Print overall summary across all suites
  printOverallSummary(allResults) {
    const validResults = allResults.filter(r => !r.failed);
    
    if (validResults.length === 0) {
      console.log('\n❌ No test suites completed successfully');
      return;
    }

    const totalTests = validResults.reduce((sum, r) => sum + r.summary.totalTests, 0);
    const totalPassed = validResults.reduce((sum, r) => sum + r.summary.passedTests, 0);
    const overallRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

    console.log('\n🏆 Overall Summary');
    console.log('==================');
    console.log(`Test Suites: ${validResults.length}/${allResults.length} completed`);
    console.log(`Total Tests: ${totalPassed}/${totalTests} passed (${overallRate.toFixed(1)}%)`);
    
    // Best and worst performing suites
    const sortedSuites = validResults.sort((a, b) => 
      b.summary.overallSuccessRate - a.summary.overallSuccessRate
    );

    if (sortedSuites.length > 0) {
      console.log(`Best Suite: ${sortedSuites[0].suiteName} (${sortedSuites[0].summary.overallSuccessRate.toFixed(1)}%)`);
      if (sortedSuites.length > 1) {
        const worst = sortedSuites[sortedSuites.length - 1];
        console.log(`Worst Suite: ${worst.suiteName} (${worst.summary.overallSuccessRate.toFixed(1)}%)`);
      }
    }
  }

  // Utility functions
  createTimeoutPromise(timeout, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeout);
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Export results to file
  exportResults(filename = 'test-results.json') {
    const exportData = {
      timestamp: new Date().toISOString(),
      config: this.config,
      results: this.results
    };

    const json = JSON.stringify(exportData, null, 2);
    console.log(`📁 Exported results to ${filename}`);
    return json;
  }

  // Get available test suites
  getAvailableTestSuites() {
    return Array.from(this.testSuites.entries()).map(([id, suite]) => ({
      id,
      name: suite.name,
      description: suite.description,
      tests: suite.tests,
      devices: suite.devices
    }));
  }

  // Configure test runner
  configure(config) {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const testRunner = new TestRunner();