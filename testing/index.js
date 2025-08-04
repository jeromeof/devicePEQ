// index.js
// Main entry point for the USB device testing framework

import { testRunner } from './testRunner.js';
import { testHarness } from './testHarness.js';
import { mockDeviceDB } from './mockDeviceDatabase.js';
import { MockDeviceFactory } from './mockUSBDevice.js';
import { payloadRecorder } from './payloadRecorder.js';

// Export main testing components
export {
  testRunner,
  testHarness,
  mockDeviceDB,
  MockDeviceFactory,
  payloadRecorder
};

// Simple CLI interface for running tests
export class TestInterface {
  static async runBasicTests() {
    console.log('🧪 Running Basic Device Handler Tests');
    console.log('=====================================');
    
    try {
      const results = await testRunner.runTestSuite('basic', { verbose: true });
      return results;
    } catch (error) {
      console.error('❌ Error running basic tests:', error);
      throw error;
    }
  }

  static async runRegressionTests() {
    console.log('🔍 Running Regression Tests');
    console.log('============================');
    
    try {
      const results = await testRunner.runTestSuite('regression', { verbose: true });
      return results;
    } catch (error) {
      console.error('❌ Error running regression tests:', error);
      throw error;
    }
  }

  static async runAllTests() {
    console.log('🚀 Running All Test Suites');
    console.log('===========================');
    
    try {
      const results = await testRunner.runAllSuites({ verbose: true });
      return results;
    } catch (error) {
      console.error('❌ Error running all tests:', error);
      throw error;
    }
  }

  static async testSpecificDevice(deviceId) {
    console.log(`🎯 Testing Specific Device: ${deviceId}`);
    console.log('================================');
    
    const profile = mockDeviceDB.getDevice(deviceId);
    if (!profile) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    console.log(`Device: ${profile.productName} (${profile.manufacturer})`);
    console.log(`Handler: ${profile.handler}`);
    
    try {
      const results = await testHarness.runDeviceTests(deviceId, { verbose: true });
      return results;
    } catch (error) {
      console.error('❌ Error testing device:', error);
      throw error;
    }
  }

  static listAvailableDevices() {
    console.log('📱 Available Mock Devices');
    console.log('=========================');
    
    const devices = MockDeviceFactory.listAvailableDevices();
    devices.forEach(device => {
      console.log(`📌 ${device.id}`);
      console.log(`   Name: ${device.name}`);
      console.log(`   Manufacturer: ${device.manufacturer}`);
      console.log(`   Handler: ${device.handler}`);
      console.log(`   Type: ${device.type}`);
      console.log('');
    });
    
    return devices;
  }

  static listTestSuites() {
    console.log('🧪 Available Test Suites');
    console.log('========================');
    
    const suites = testRunner.getAvailableTestSuites();
    suites.forEach(suite => {
      console.log(`📋 ${suite.id}: ${suite.name}`);
      console.log(`   Description: ${suite.description}`);
      console.log(`   Tests: ${suite.tests.join(', ')}`);
      console.log(`   Devices: ${Array.isArray(suite.devices) ? suite.devices.join(', ') : suite.devices}`);
      console.log('');
    });
    
    return suites;
  }

  static async startPayloadRecording(deviceInfo) {
    console.log('🔴 Starting Payload Recording');
    console.log('=============================');
    
    try {
      payloadRecorder.startRecording(deviceInfo);
      console.log(`Recording interactions for: ${deviceInfo.productName}`);
      console.log('Use stopPayloadRecording() to stop and save the session');
    } catch (error) {
      console.error('❌ Error starting recording:', error);
      throw error;
    }
  }

  static stopPayloadRecording() {
    console.log('⏹️ Stopping Payload Recording');
    console.log('==============================');
    
    try {
      const session = payloadRecorder.stopRecording();
      console.log(`Recorded ${session.interactions.length} interactions`);
      console.log(`Duration: ${(session.duration / 1000).toFixed(2)}s`);
      
      return session;
    } catch (error) {
      console.error('❌ Error stopping recording:', error);
      throw error;
    }
  }

  static async createMockFromRecording(session, deviceId) {
    console.log('🎭 Creating Mock Device from Recording');
    console.log('======================================');
    
    try {
      const profile = payloadRecorder.updateMockDatabase(session, deviceId);
      console.log(`Created mock device profile: ${deviceId}`);
      console.log(`Device: ${profile.productName}`);
      console.log(`Interactions: ${Object.keys(profile.interactions || {}).length}`);
      
      return profile;
    } catch (error) {
      console.error('❌ Error creating mock device:', error);
      throw error;
    }
  }

  static exportResults(filename) {
    console.log('📁 Exporting Test Results');
    console.log('=========================');
    
    try {
      const json = testRunner.exportResults(filename);
      console.log(`Results exported to: ${filename}`);
      return json;
    } catch (error) {
      console.error('❌ Error exporting results:', error);
      throw error;
    }
  }

  static async demonstrateFramework() {
    console.log('🎬 USB Device Testing Framework Demo');
    console.log('====================================');
    
    try {
      // List available devices
      console.log('\n1. Available Mock Devices:');
      this.listAvailableDevices();
      
      // List test suites
      console.log('\n2. Available Test Suites:');
      this.listTestSuites();
      
      // Run a quick test on FiiO device
      console.log('\n3. Quick Test Example:');
      const fiioResult = await testHarness.runSpecificTest('fiio_k9_pro', 'connection', { verbose: true });
      console.log(`FiiO connection test: ${fiioResult.passed ? '✅ PASSED' : '❌ FAILED'}`);
      
      // Run a basic test suite
      console.log('\n4. Running Basic Test Suite:');
      const basicResults = await testRunner.runTestSuite('basic', { verbose: false });
      
      console.log('\n✅ Demo completed successfully!');
      console.log('\nNext steps:');
      console.log('- Use TestInterface.runAllTests() for comprehensive testing');
      console.log('- Use payloadRecorder to capture real device interactions');
      console.log('- Add new device profiles to mockDeviceDatabase.js');
      console.log('- Create custom test scenarios in testRunner.js');
      
      return {
        devicesAvailable: MockDeviceFactory.listAvailableDevices().length,
        testSuitesAvailable: testRunner.getAvailableTestSuites().length,
        demoResults: basicResults
      };
      
    } catch (error) {
      console.error('❌ Demo failed:', error);
      throw error;
    }
  }
}

// Default export for easy importing
export default TestInterface;