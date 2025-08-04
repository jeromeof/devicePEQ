# USB Device Testing Framework

A comprehensive testing framework for USB device handlers with mock devices, payload recording, and automated regression testing.

## 🚀 Quick Start

```javascript
import TestInterface from './testing/index.js';

// Run all tests
await TestInterface.runAllTests();

// Test specific device
await TestInterface.testSpecificDevice('fiio_k9_pro');

// List available devices and test suites
TestInterface.listAvailableDevices();
TestInterface.listTestSuites();
```

## 📁 Framework Components

### Core Components

- **`mockDeviceDatabase.js`** - Database of mock device profiles with recorded interactions
- **`mockUSBDevice.js`** - Mock USB/HID devices that simulate real hardware behavior  
- **`testHarness.js`** - Test execution engine for individual device handlers
- **`testRunner.js`** - Test suite runner with predefined test scenarios
- **`payloadRecorder.js`** - Records real device interactions for regression testing
- **`index.js`** - Main interface and example usage

### Mock Device Database

The framework includes pre-configured mock devices:

- **FiiO K9 Pro** (`fiio_k9_pro`) - HID device with 5-band EQ
- **JDS Labs Element IV** (`jds_element_iv`) - Serial device with 12-band EQ  
- **Qudelix 5K** (`qudelix_5k`) - HID device with 10-band EQ and custom protocol
- **Moondrop DAWN PRO** (`moondrop_dawn_pro`) - HID device with experimental support

## 🧪 Test Suites

### Available Test Suites

1. **`basic`** - Core functionality tests (connection, pull, push, slots)
2. **`regression`** - Full regression testing with error scenarios
3. **`fiio`** - FiiO-specific device tests
4. **`qudelix`** - Qudelix-specific device tests  
5. **`jds`** - JDS Labs serial device tests
6. **`performance`** - Performance characteristic tests
7. **`stress`** - Stress testing with rapid operations

### Running Test Suites

```javascript
import { testRunner } from './testing/testRunner.js';

// Run specific test suite
const results = await testRunner.runTestSuite('basic', { 
  verbose: true,
  timeout: 30000,
  retries: 2
});

// Run all test suites
const allResults = await testRunner.runAllSuites();

// Export results
testRunner.exportResults('test-results.json');
```

## 📹 Recording Real Device Interactions

### Recording Payloads

```javascript
import { payloadRecorder } from './testing/payloadRecorder.js';

// Start recording
payloadRecorder.startRecording({
  device: realUSBDevice, // Your actual WebHID device
  productName: "My Device",
  manufacturer: "Device Corp",
  vendorId: 0x1234,
  productId: 0x5678
});

// ... interact with the device normally ...

// Stop recording and get session
const session = payloadRecorder.stopRecording();

// Create mock device profile from recording
payloadRecorder.updateMockDatabase(session, 'my_device_id');
```

### Using Recorded Payloads

The recorded interactions automatically become available as mock responses:

```javascript
import { MockDeviceFactory } from './testing/mockUSBDevice.js';

// Create mock device with recorded interactions
const mockDevice = MockDeviceFactory.createDevice('my_device_id');

// Device will replay recorded responses to matching commands
await mockDevice.open();
await mockDevice.sendReport(7, commandData); // Gets recorded response
```

## 🔧 Creating Custom Tests

### Adding New Device Profiles

```javascript
import { mockDeviceDB } from './testing/mockDeviceDatabase.js';

mockDeviceDB.addDevice('my_new_device', {
  vendorId: 0x1234,
  productId: 0x5678,
  productName: "My New Device",
  manufacturer: "My Company",
  handler: "myDeviceHandler",
  
  collections: [/* HID descriptor */],
  modelConfig: {/* device configuration */},
  interactions: {/* recorded payloads */}
});
```

### Custom Test Scenarios

```javascript
import { testRunner } from './testing/testRunner.js';

// Add custom test suite
testRunner.addTestSuite('custom', {
  name: 'Custom Tests',
  description: 'My custom test scenarios',
  tests: ['connection', 'pull', 'push'],
  devices: ['my_device_id'],
  scenarios: ['custom_scenario']
});
```

### Custom Scenarios

Add scenarios to `testRunner.js`:

```javascript
custom_scenario: {
  name: 'My Custom Test',
  execute: async (mockDevice, profile) => {
    // Your custom test logic
    await mockDevice.open();
    
    // Simulate specific device behavior
    mockDevice.setCustomResponse('myCommand', expectedResponse);
    
    // Test your handler
    const result = await myHandler.doSomething(mockDevice);
    
    return {
      success: result.isValid,
      message: 'Custom test completed',
      details: result
    };
  }
}
```

## 📊 Test Reports

### Understanding Results

Test results include:

```javascript
{
  suiteId: 'basic',
  suiteName: 'Basic Functionality Tests',
  duration: 5432, // milliseconds
  summary: {
    totalTests: 20,
    passedTests: 18,
    failedTests: 2,
    overallSuccessRate: 90.0,
    deviceSummary: {
      'fiio_k9_pro': { passed: 5, failed: 0 },
      'qudelix_5k': { passed: 4, failed: 1 }
    }
  },
  results: [/* detailed per-device results */]
}
```

### Exporting Results

```javascript
// Export to JSON
const json = testRunner.exportResults('results.json');

// Generate detailed report
const report = testHarness.generateReport();
```

## 🐛 Debugging Tests

### Verbose Mode

```javascript
// Enable detailed logging
await testRunner.runTestSuite('basic', { verbose: true });
```

### Mock Device Debugging

```javascript
import { MockUSBDevice } from './testing/mockUSBDevice.js';

const mockDevice = new MockUSBDevice(deviceProfile);

// Check sent reports
await mockDevice.sendReport(7, data);
const sentReports = mockDevice.getSentReports();
console.log('Sent reports:', sentReports);

// Simulate specific errors
mockDevice.simulateError('timeout');
mockDevice.simulateError('disconnect');
mockDevice.simulateError('malformed');
```

### Payload Analysis

```javascript
import { PayloadAnalyzer } from './testing/payloadRecorder.js';

// Analyze recorded payloads
const analysis = PayloadAnalyzer.analyzePayloadPattern([
  new Uint8Array([0x01, 0x02, 0x03]),
  new Uint8Array([0x01, 0x02, 0x04]),
  new Uint8Array([0x01, 0x02, 0x05])
]);

console.log('Common bytes:', analysis.commonBytes);
console.log('Variable bytes:', analysis.variableBytes);
console.log('Possible commands:', analysis.possibleCommands);
```

## 🔄 Continuous Integration

### Automated Testing

```javascript
// CI/CD integration example
import TestInterface from './testing/index.js';

async function runCITests() {
  try {
    // Run regression tests
    const results = await TestInterface.runRegressionTests();
    
    // Check if all tests passed
    const successRate = results.summary.overallSuccessRate;
    
    if (successRate < 95) {
      console.error(`❌ Tests failed: ${successRate}% success rate`);
      process.exit(1);
    }
    
    console.log(`✅ All tests passed: ${successRate}% success rate`);
    return results;
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

runCITests();
```

## 📝 Best Practices

### 1. Recording Device Interactions

- Record complete interaction sequences (connect → pull → push → disconnect)
- Test multiple scenarios (empty EQ, full EQ, error conditions)
- Record with different device configurations
- Validate recorded data before using in tests

### 2. Writing Handler Tests

- Test all required methods (`getCurrentSlot`, `pullFromDevice`, `pushToDevice`)
- Test optional methods (`enablePEQ`) if implemented
- Test error conditions and edge cases
- Validate return value structures

### 3. Mock Device Configuration

- Use realistic HID descriptors from actual devices
- Include proper vendor/product IDs
- Configure accurate model constraints (maxFilters, gainRange, etc.)
- Add multiple test scenarios per device

### 4. Test Maintenance

- Update mock devices when handlers change
- Re-record interactions when protocols evolve
- Review test failures to identify regressions
- Add new test scenarios for discovered edge cases

## 🚀 Demo

Run the framework demonstration:

```javascript
import TestInterface from './testing/index.js';

// Complete demo of all features
await TestInterface.demonstrateFramework();
```

This will:
1. List available mock devices
2. Show available test suites  
3. Run example tests
4. Display framework capabilities

## 📚 API Reference

See individual component files for detailed API documentation:

- [Mock Device Database API](./mockDeviceDatabase.js)
- [Mock USB Device API](./mockUSBDevice.js)  
- [Test Harness API](./testHarness.js)
- [Test Runner API](./testRunner.js)
- [Payload Recorder API](./payloadRecorder.js)

## 🤝 Contributing

1. Add new device profiles to `mockDeviceDatabase.js`
2. Record real device interactions using `payloadRecorder`
3. Create device-specific test scenarios
4. Add new test types to `testHarness.js`
5. Extend test suites in `testRunner.js`

## 📄 License

This testing framework is part of the DevicePEQ project.