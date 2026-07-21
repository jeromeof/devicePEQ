/**
 * Capture and Inspect Utility
 * ════════════════════════════════════════════════════════════════════════════
 * Records packets sent by handlers and provides detailed analysis.
 *
 * Usage:
 *   import { PacketCapture } from './captureAndInspect.js';
 *
 *   // Create capture device
 *   const capture = new PacketCapture({ name: 'my-device', verbose: true });
 *
 *   // Use like a normal HID device
 *   await handler.pushToDevice({ rawDevice: capture.device, ... }, ...);
 *
 *   // Analyze captured packets
 *   console.log(capture.summary());
 *   capture.packets.forEach(p => console.log(capture.inspect(p)));
 */

import { inspectConexantPacket, formatPacketInspection, verifyPacketSequence, summaryOfSequence } from './packetInspector.js';

export class PacketCapture {
  constructor({ name = 'device', verbose = false } = {}) {
    this.name = name;
    this.verbose = verbose;
    this.packets = [];
    this.device = this._createMockDevice();
  }

  _createMockDevice() {
    return {
      opened: true,
      oninputreport: null,
      sendReport: async (reportId, data) => {
        const bytes = Array.from(data instanceof Uint8Array ? data : new Uint8Array(data));
        this.packets.push({
          reportId,
          bytes: new Uint8Array(bytes),
          timestamp: Date.now()
        });
        if (this.verbose) {
          console.log(`[${this.name}] sendReport(${reportId}, ${bytes.length} bytes)`);
        }
      }
    };
  }

  /**
   * Get summary of all captured packets
   */
  summary() {
    if (this.packets.length === 0) {
      return 'No packets captured';
    }

    const packets = this.packets.map(p => p.bytes);
    return summaryOfSequence(packets);
  }

  /**
   * Inspect individual packet
   */
  inspect(packetOrIndex) {
    let packet;
    if (typeof packetOrIndex === 'number') {
      packet = this.packets[packetOrIndex];
    } else {
      packet = packetOrIndex;
    }

    if (!packet) {
      return 'Invalid packet index';
    }

    const inspection = inspectConexantPacket(packet.bytes);
    return formatPacketInspection(inspection);
  }

  /**
   * Export captured sequence as JSON
   */
  export() {
    return {
      device: this.name,
      timestamp: new Date().toISOString(),
      packetCount: this.packets.length,
      packets: this.packets.map((p, i) => ({
        index: i,
        reportId: p.reportId,
        size: p.bytes.length,
        hex: Array.from(p.bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
      }))
    };
  }

  /**
   * Verify the captured sequence is valid
   */
  verify() {
    const packets = this.packets.map(p => p.bytes);
    return verifyPacketSequence(packets);
  }

  /**
   * Print detailed analysis of all packets
   */
  printDetailed() {
    const lines = [];
    lines.push(`\n╔════════════════════════════════════════════════════════════╗`);
    lines.push(`║ Captured Packets: ${this.name}`);
    lines.push(`║ Total: ${this.packets.length}`);
    lines.push(`╚════════════════════════════════════════════════════════════╝\n`);

    this.packets.forEach((packet, i) => {
      lines.push(`Packet ${i + 1}/${this.packets.length}:`);
      lines.push(`─────────────────────────────────────────────────────────`);

      const inspection = inspectConexantPacket(packet.bytes);
      if (inspection.valid) {
        lines.push(`Type: ${inspection.packetType.toUpperCase()}`);
        lines.push(`Valid: ✓`);

        if (inspection.analysis) {
          if (inspection.packetType === 'config') {
            lines.push(`  Band: ${inspection.analysis.bandNumber}`);
            lines.push(`  Frequency: ${inspection.analysis.frequency} Hz`);
            lines.push(`  Q: ${inspection.analysis.q}`);
            lines.push(`  Gain: ${inspection.analysis.gain} dB`);
            lines.push(`  Type: ${inspection.analysis.filterType}`);
          } else if (inspection.packetType === 'biquad') {
            lines.push(`  Sample Rate: ${inspection.analysis.sampleRate}`);
            lines.push(`  Band: ${inspection.analysis.bandNumber}`);
            lines.push(`  B0: ${inspection.analysis.coefficients.b0}`);
            lines.push(`  B1: ${inspection.analysis.coefficients.b1}`);
            lines.push(`  B2: ${inspection.analysis.coefficients.b2}`);
          } else if (inspection.packetType === 'mode') {
            lines.push(`  Mode: ${inspection.analysis.modeIndex}`);
          }
        }
      } else {
        lines.push(`Valid: ✗ ${inspection.error}`);
      }

      lines.push('');
    });

    lines.push(this.summary());
    return lines.join('\n');
  }
}

/**
 * Example usage — captures packets from a handler execution
 */
export async function captureHandlerExecution(handler, deviceDetails, phoneObj, slot, globalGain, filters) {
  const capture = new PacketCapture({
    name: `${deviceDetails.manufacturer}-${deviceDetails.model}`,
    verbose: true
  });

  // Add capture device to details
  const captureDetails = {
    ...deviceDetails,
    rawDevice: capture.device
  };

  try {
    await handler.pushToDevice(captureDetails, phoneObj, slot, globalGain, filters);
  } catch (e) {
    console.error('Handler execution failed:', e.message);
  }

  return capture;
}
