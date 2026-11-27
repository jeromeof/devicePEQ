// Run against a local server: node tests/integration/writeOnly.browser.mjs http://127.0.0.1:8847
// Uses fake connectors only; never opens device hardware.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.argv[2] ?? 'http://127.0.0.1:8847';
const browser = await chromium.launch({ headless: true });
try {
  for (const type of ['usb', 'serial', 'ble', 'network']) {
    for (const writeOnly of [true, false]) {
      const page = await browser.newPage();
      await page.route('**/write-only-test', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><div class="extra-eq"></div>',
      }));
      await page.goto(`${origin}/write-only-test`);
      const result = await page.evaluate(async ({ type, writeOnly }) => {
        if (!navigator.hid) Object.defineProperty(navigator, 'hid', { value: {}, configurable: true });
        window.DEVICEPEQ_CONFIG_BASE_URL = new URL('/devicePEQ/', location.href).href;
        const connectors = {
          usb: ['usbHidConnector.js', 'UsbHIDConnector'],
          serial: ['usbSerialConnector.js', 'UsbSerialConnector'],
          ble: ['bluetoothBleConnector.js', 'BluetoothBleConnector'],
          network: ['networkDeviceConnector.js', 'NetworkDeviceConnector'],
        };
        const [file, key] = connectors[type];
        const connector = await (await import(`/devicePEQ/${file}`))[key];
        let slotReads = 0, peqReads = 0;
        const device = {
          model: 'Capability test', manufacturer: 'Test', handler: {},
          rawDevice: { addEventListener() {} },
          modelConfig: {
            writeOnly, peqConstraintsRef: 'peq10Band12dBFullShelves',
            firstWritableEQSlot: 101, availableSlots: [{ id: 101, name: 'Custom' }],
          },
        };
        connector.getDeviceConnected = async () => device;
        connector.getCurrentSlot = async () => { slotReads++; return 101; };
        connector.getAvailableSlots = async () => device.modelConfig.availableSlots;
        connector.pullFromDevice = async () => { peqReads++; return { filters: [] }; };
        let complete;
        const done = new Promise(resolve => { complete = resolve; });
        const initialize = (await import('/devicePEQ/plugin.js')).default;
        await initialize({
          config: { pullValuesOnConnect: true, debugLogs: true },
          elemToFilters: () => [], onDeviceConnected: () => complete(),
        });
        const connect = document.querySelector('.connect-device');
        connect.dataset.connectionType = type;
        if (type === 'network') {
          connect.dataset.networkIp = '127.0.0.1';
          connect.dataset.networkDeviceType = 'WiiM';
        }
        connect.click();
        await Promise.race([
          done,
          new Promise((_, reject) => setTimeout(() => reject(Error('connect callback timeout')), 4000)),
        ]);
        const load = document.querySelector('.pull-filters-fromdevice');
        // A synthetic click must not bypass the disabled control's capability guard.
        if (writeOnly) {
          load.dispatchEvent(new MouseEvent('click'));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        return {
          slotReads, peqReads, loadDisabled: load.disabled,
          saveDisabled: document.querySelector('.push-filters-todevice').disabled,
        };
      }, { type, writeOnly });
      assert.deepEqual(result, {
        slotReads: writeOnly ? 0 : 1, peqReads: writeOnly ? 0 : 1,
        loadDisabled: writeOnly, saveDisabled: false,
      }, `${type}, writeOnly=${writeOnly}`);
      console.log(`PASS ${type}, writeOnly=${writeOnly}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
