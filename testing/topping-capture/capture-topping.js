#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const readline = require('readline');

const CAPTURE_SCRIPT = `
(function() {
  const logs = [];

  // Intercept HID operations
  const originalSendReport = HIDDevice.prototype.sendReport;
  const originalReceiveFeatureReport = HIDDevice.prototype.receiveFeatureReport;

  HIDDevice.prototype.sendReport = async function(reportId, data) {
    const bytes = Array.from(new Uint8Array(data));
    const log = {
      type: 'sendReport',
      reportId,
      bytes,
      hex: bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
      timestamp: new Date().toISOString()
    };
    logs.push(log);
    console.log('[HID TX]', JSON.stringify(log));
    return originalSendReport.call(this, reportId, data);
  };

  HIDDevice.prototype.receiveFeatureReport = async function(reportId) {
    console.log('[HID RX] waiting for feature report...');
    const result = await originalReceiveFeatureReport.call(this, reportId);
    const bytes = Array.from(new Uint8Array(result.buffer));
    const log = {
      type: 'receiveFeatureReport',
      reportId,
      bytes,
      hex: bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
      timestamp: new Date().toISOString()
    };
    logs.push(log);
    console.log('[HID RX]', JSON.stringify(log));
    return result;
  };

  // Also capture inputreport events
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, ...args) {
    if (type === 'inputreport') {
      const wrappedListener = (event) => {
        const bytes = Array.from(new Uint8Array(event.data.buffer));

        // Skip all-zero frames (device noise)
        if (bytes.every(b => b === 0)) {
          return listener.call(this, event);
        }

        const log = {
          type: 'inputreport',
          reportId: event.reportId,
          bytes,
          hex: bytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
          timestamp: new Date().toISOString()
        };
        logs.push(log);
        console.log('[HID INPUTREPORT]', JSON.stringify(log));
        return listener.call(this, event);
      };
      return originalAddEventListener.call(this, type, wrappedListener, ...args);
    }
    return originalAddEventListener.call(this, type, listener, ...args);
  };

  // Expose logs globally
  window.hidLogs = logs;
  window.exportHidLogs = function() {
    return logs;
  };

  console.log('✓ WebHID capture enabled');
})();
`;

async function captureWebHID(url) {
  console.log('🚀 Launching Chrome with Playwright...');

  const browser = await chromium.launch({
    headless: false
  });

  const page = await browser.newPage();

  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(msg.text());
    if (msg.text().includes('[HID')) {
      console.log('  ' + msg.text());
    }
  });

  // Inject script before navigation
  console.log('💉 Setting up WebHID capture script...');
  await page.addInitScript(CAPTURE_SCRIPT);

  console.log(`📄 Navigating to ${url}...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log('⚠️  Page loaded (with some timeouts - this is OK)');
  }

  // Wait a bit for page to settle
  await page.waitForTimeout(2000);

  console.log('\n✅ READY TO CAPTURE!\n');
  console.log('📋 Instructions:');
  console.log('  1. In the Chrome window, click "Connect" or "Add Device"');
  console.log('  2. Select your Topping DX1 II');
  console.log('  3. Grant WebHID permissions when prompted');
  console.log('  4. Go to EQ settings');
  console.log('  5. Try these actions (watch packets appear below):');
  console.log('     - Read/Load current EQ');
  console.log('     - Change a frequency value');
  console.log('     - Change a gain value');
  console.log('     - Change a Q value');
  console.log('     - Save/Apply the changes');
  console.log('\n  6. When done, close the browser window\n');

  // Monitor for packets
  let lastLogCount = 0;
  let noChangeCount = 0;

  const interval = setInterval(async () => {
    try {
      const logCount = await page.evaluate(() => window.hidLogs?.length || 0);

      if (logCount > lastLogCount) {
        console.log(`📊 Captured ${logCount} packets total`);
        lastLogCount = logCount;
        noChangeCount = 0;
      } else if (logCount > 0) {
        noChangeCount++;
      }

      // Auto-export after 10 seconds of no new packets
      if (noChangeCount > 20 && logCount > 0) {
        console.log('\n⏱️  No new packets in 10 seconds, auto-exporting...\n');
        clearInterval(interval);
        await exportAndClose(page);
      }
    } catch (e) {
      // Page closed
      clearInterval(interval);
    }
  }, 500);

  // Handle window close
  page.on('close', async () => {
    clearInterval(interval);
    console.log('\n\n📤 Chrome closed, exporting logs...');
    await exportAndClose(page);
  });

  async function exportAndClose(p) {
    try {
      const logs = await p.evaluate(() => window.exportHidLogs?.() || []);

      if (logs.length === 0) {
        console.log('⚠️  No HID packets captured. Make sure:');
        console.log('   - Device connected successfully');
        console.log('   - Chrome console shows "[HID TX]" or "[HID RX]" messages');
        console.log('   - Using Chrome/Chromium (not Firefox)');
      } else {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `topping_webhid_capture_${timestamp}.json`;
        const filepath = path.join(process.cwd(), filename);

        fs.writeFileSync(filepath, JSON.stringify(logs, null, 2));

        console.log(`\n✨ Exported ${logs.length} packets to:`);
        console.log(`   ${filepath}\n`);

        // Summary
        const byType = {};
        logs.forEach(log => {
          byType[log.type] = (byType[log.type] || 0) + 1;
        });

        console.log('📊 Packet Summary:');
        Object.entries(byType).forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`);
        });

        // First few packets
        console.log('\n📋 Sample Packets:');
        logs.slice(0, 3).forEach((log, i) => {
          const hex = log.hex.substring(0, 70);
          console.log(`   [${i}] ${log.type} (reportId:${log.reportId})`);
          console.log(`       ${hex}${log.hex.length > 70 ? '...' : ''}`);
        });

        console.log('\n✅ Share this JSON file for protocol analysis!');
      }
    } catch (e) {
      console.error('Error:', e.message);
    }

    await browser.close();
    process.exit(0);
  }

  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\n⏹️  Stopping capture...');
    clearInterval(interval);
    const logs = await page.evaluate(() => window.exportHidLogs?.() || []);
    if (logs.length > 0) {
      await exportAndClose(page);
    } else {
      await browser.close();
      process.exit(0);
    }
  });
}

// Main
const args = process.argv.slice(2);
let url = args[0];

if (!url) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('🌐 Enter Topping webpage URL (e.g., https://topping.home/app): ', (answer) => {
    rl.close();
    url = answer.trim();
    if (!url) {
      console.error('❌ URL required');
      process.exit(1);
    }
    captureWebHID(url).catch(err => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
  });
} else {
  captureWebHID(url).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
