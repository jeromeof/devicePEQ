// Test the updated filter logic
function isKeepalivePacket(bytes) {
    if (bytes.length < 3) return false;

    // TX preset query pattern: 05 5A 06 00 00 0A XX [counter] (last 3 bytes vary)
    if (bytes.length === 10 &&
        bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x06 &&
        bytes[3] === 0x00 && bytes[4] === 0x00 && bytes[5] === 0x0A) {
        return true;
    }

    // RX preset response pattern: 05 5B BD 00 00 0A [preset data] (193 bytes)
    if (bytes.length === 193 &&
        bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0xBD &&
        bytes[3] === 0x00 && bytes[4] === 0x00 && bytes[5] === 0x0A) {
        return true;
    }

    // TX status query: 05 5A 04 00 83 2C [counter] 00 (byte 6 is counter)
    if (bytes.length === 8 &&
        bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x04 &&
        bytes[3] === 0x00 && bytes[4] === 0x83 && bytes[5] === 0x2C &&
        bytes[7] === 0x00) {
        return true;
    }

    // RX status response: 05 5B 06 00 83 2C 00 [counter] 00 XX (byte 7 is counter)
    if (bytes.length === 10 &&
        bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x06 &&
        bytes[3] === 0x00 && bytes[4] === 0x83 && bytes[5] === 0x2C &&
        bytes[6] === 0x00 && bytes[8] === 0x00) {
        return true;
    }

    // TX status query: 05 5A 04 00 01 09 [counter] 00 (byte 6 is counter)
    if (bytes.length === 8 &&
        bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x04 &&
        bytes[3] === 0x00 && bytes[4] === 0x01 && bytes[5] === 0x09 &&
        bytes[7] === 0x00) {
        return true;
    }

    // RX status response: 05 5B 06 00 01 09 [counter] 00 00 XX (byte 6 is counter)
    if (bytes.length === 10 &&
        bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x06 &&
        bytes[3] === 0x00 && bytes[4] === 0x01 && bytes[5] === 0x09 &&
        bytes[7] === 0x00 && bytes[8] === 0x00) {
        return true;
    }

    // TX Battery Status: 05 5A 02 00 10 09
    if (bytes.length === 6 &&
        bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x02 &&
        bytes[3] === 0x00 && bytes[4] === 0x10 && bytes[5] === 0x09) {
        return true;
    }

    // RX Battery Status response: 05 5B 0C 00 10 09 ... (16 bytes)
    if (bytes.length === 16 &&
        bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x0C &&
        bytes[3] === 0x00 && bytes[4] === 0x10 && bytes[5] === 0x09) {
        return true;
    }

    // Generic connect status (repeating heartbeat)
    if (bytes.length === 7 &&
        bytes[0] === 0x05 && bytes[1] === 0x5A && bytes[2] === 0x03 &&
        bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C) {
        return true;
    }

    if (bytes.length === 7 &&
        bytes[0] === 0x05 && bytes[1] === 0x5B && bytes[2] === 0x03 &&
        bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C) {
        return true;
    }

    // Unknown protocol keepalive (0x5D)
    if (bytes.length === 9 &&
        bytes[0] === 0x05 && bytes[1] === 0x5D && bytes[2] === 0x05 &&
        bytes[3] === 0x00 && bytes[4] === 0xD6 && bytes[5] === 0x0C) {
        return true;
    }

    return false;
}

function hexToBytes(hex) {
    const parts = hex.replace('Hex: ', '').trim().split(' ');
    return parts.map(h => parseInt(h, 16));
}

// Test with packets from keepalive_packets.txt
const testPackets = [
    // Preset query patterns (should be filtered)
    'Hex: 05 5A 06 00 00 0A 01 E4 E8 03',  // TX query preset 1 (counter E4)
    'Hex: 05 5A 06 00 00 0A 02 E4 E8 03',  // TX query preset 2 (counter E4)
    'Hex: 05 5A 06 00 00 0A 00 EF E8 03',  // TX query preset 0 (counter EF)
    'Hex: 05 5A 06 00 00 0A 13 EF E8 03',  // TX query preset 0x13 (counter EF)
    'Hex: 05 5B BD 00 00 0A B9 00 01 00 00 00 00 01 02 80 0C 00 00 58 02 00 00 40 06 00 00 C8 00 00 00 01 02 00 19 00 00 00 00 00 00 80 0C 00 00 C8 00 00 00 01 02 D4 30 00 00 00 00 00 00 6A 18 00 00 C8 00 00 00 01 02 A8 61 00 00 00 00 00 00 D4 30 00 00 C8 00 00 00 01 02 50 C3 00 00 00 00 00 00 A8 61 00 00 C8 00 00 00 01 02 A0 86 01 00 00 00 00 00 50 C3 00 00 C8 00 00 00 01 02 40 0D 03 00 00 00 00 00 A0 86 01 00 C8 00 00 00 01 02 80 1A 06 00 00 00 00 00 40 0D 03 00 C8 00 00 00 01 02 00 35 0C 00 00 00 00 00 80 1A 06 00 C8 00 00 00 01 02 00 6A 18 00 00 00 00 00 00 35 0C 00 C8 00 00 00',  // RX preset data

    // Status query patterns with varying counters (should be filtered)
    'Hex: 05 5A 04 00 83 2C 07 00',  // TX status with counter 07
    'Hex: 05 5A 04 00 83 2C 0B 00',  // TX status with counter 0B
    'Hex: 05 5B 06 00 83 2C 00 07 00 00',  // RX status with counter 07
    'Hex: 05 5B 06 00 83 2C 00 0B 00 0A',  // RX status with counter 0B
    'Hex: 05 5A 04 00 01 09 2C 00',  // TX status with counter 2C
    'Hex: 05 5A 04 00 01 09 22 00',  // TX status with counter 22
    'Hex: 05 5B 06 00 01 09 2C 00 00 01',  // RX status with counter 2C
    'Hex: 05 5B 06 00 01 09 22 00 00 00',  // RX status with counter 22

    // Battery and connect status (should be filtered)
    'Hex: 05 5A 02 00 10 09',  // TX Battery Status
    'Hex: 05 5B 0C 00 10 09 00 05 00 FF 00 02 01 07 07 01',  // RX Battery Status
    'Hex: 05 5A 03 00 D6 0C 00',  // TX Connect Status
    'Hex: 05 5B 03 00 D6 0C 00',  // RX Connect Status
    'Hex: 05 5D 05 00 D6 0C 00 00 5F',  // Unknown protocol keepalive

    // Non-keepalive packet (should NOT be filtered)
    'Hex: 05 5A 4F 03 03 0E 00 04',  // Different command
];

console.log('Testing filter logic:\n');
testPackets.forEach(hex => {
    const bytes = hexToBytes(hex);
    const filtered = isKeepalivePacket(bytes);
    const shortHex = hex.substring(0, 60) + (hex.length > 60 ? '...' : '');
    console.log(`${filtered ? '✓ FILTERED' : '✗ KEPT    '}: ${shortHex}`);
});

console.log('\n✅ All preset query/response patterns should be FILTERED');
console.log('✅ Other packets should be KEPT');
