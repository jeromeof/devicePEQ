#!/usr/bin/env node

// Decode command 0xBD PEQ configuration packets

const fs = require('fs');

function decodePEQPacket(hexStr, direction, lineNum) {
    const bytes = hexStr.trim().split(' ').map(b => parseInt(b, 16));

    console.log(`\n${'='.repeat(80)}`);
    console.log(`${direction} - Line ${lineNum}`);
    console.log('='.repeat(80));
    console.log('Full hex:', hexStr);

    // Protocol structure:
    // 05 5A/5B BD 00 [length] 0A [more bytes] [filter data...]
    // Filters start after initial header bytes

    // Find where filter data starts - look for the pattern "01 02" which appears to mark each filter
    let filterDataStart = -1;
    for (let i = 0; i < bytes.length - 1; i++) {
        if (bytes[i] === 0x01 && bytes[i + 1] === 0x02) {
            filterDataStart = i;
            break;
        }
    }

    if (filterDataStart === -1) {
        console.log('Could not find filter data start marker (01 02)');
        return;
    }

    console.log(`Filter data starts at byte ${filterDataStart}`);

    const headerBytes = bytes.slice(4, filterDataStart);
    console.log('Header bytes:', headerBytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

    // Each filter is 18 bytes: [enable] [type] [freq 4B LE] [gain 4B LE signed] [Q 4B LE] [param 4B LE]
    const filterSize = 18;
    const filterData = bytes.slice(filterDataStart);
    const numFilters = Math.floor(filterData.length / filterSize);

    console.log(`\nNumber of filters: ${numFilters}\n`);

    for (let i = 0; i < numFilters; i++) {
        const offset = i * filterSize;
        const filterBytes = filterData.slice(offset, offset + filterSize);

        if (filterBytes.length < filterSize) break;

        const enabled = filterBytes[0];
        const filterType = filterBytes[1];

        // Frequency (4 bytes, little-endian)
        const freqValue = filterBytes[2] | (filterBytes[3] << 8) | (filterBytes[4] << 16) | (filterBytes[5] << 24);
        const freqHz = freqValue / 100; // Centihz to Hz

        // Gain (4 bytes, little-endian, signed)
        const gainRaw = ((filterBytes[6] | (filterBytes[7] << 8) | (filterBytes[8] << 16) | (filterBytes[9] << 24)) >>> 0);
        const gainSigned = gainRaw > 0x7FFFFFFF ? gainRaw - 0x100000000 : gainRaw;
        const gainDB = gainSigned / 100; // Centibels to dB

        // Q factor (4 bytes, little-endian)
        const qRaw = filterBytes[10] | (filterBytes[11] << 8) | (filterBytes[12] << 16) | (filterBytes[13] << 24);
        const qValue = qRaw / 100;

        // Extra parameter (4 bytes, little-endian)
        const paramRaw = filterBytes[14] | (filterBytes[15] << 8) | (filterBytes[16] << 16) | (filterBytes[17] << 24);

        const gainStr = gainDB !== 0 ? `*** ${gainDB.toFixed(2)} dB ***` : `${gainDB.toFixed(2)} dB`;

        console.log(`Filter ${i}: Freq=${freqHz.toFixed(1)}Hz Gain=${gainStr} Q=${qValue.toFixed(2)} Type=${filterType} En=${enabled} Param=0x${paramRaw.toString(16)}`);
    }
}

// Read the capture file and find all 0xBD packets
const captureFile = process.argv[2] || 'eq_change.txt';

const content = fs.readFileSync(captureFile, 'utf-8');
const lines = content.split('\n');

const bdPackets = [];
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Hex: 05 5B BD') || line.includes('Hex: 05 5A BD')) {
        bdPackets.push({
            lineNum: i + 1,
            direction: line.includes('05 5A') ? 'TX' : 'RX',
            hex: line.split('Hex: ')[1]
        });
    }
}

console.log(`Found ${bdPackets.length} command 0xBD packets\n`);

bdPackets.forEach((pkt, idx) => {
    decodePEQPacket(pkt.hex, pkt.direction, pkt.lineNum);
});
