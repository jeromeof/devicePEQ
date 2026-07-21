#!/usr/bin/env node

const fs = require('fs');

const captureFile = process.argv[2] || 'eq_change.txt';
const content = fs.readFileSync(captureFile, 'utf-8');
const lines = content.split('\n');

console.log('='.repeat(80));
console.log('CAPTURE ANALYSIS SUMMARY');
console.log('='.repeat(80));

// Extract all packets with direction and command
const packets = [];
let currentDirection = '';

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('📤 AIROHA TX')) {
        currentDirection = 'TX';
    } else if (line.includes('📥 AIROHA RX')) {
        currentDirection = 'RX';
    }

    if (line.includes('│ Command:')) {
        const match = line.match(/Command:\s+(0x[0-9A-Fa-f-]+)/);
        if (match) {
            const cmdHex = match[1];
            const cmdValue = parseInt(cmdHex, 16);
            packets.push({
                line: i + 1,
                direction: currentDirection,
                command: cmdHex,
                cmdValue: cmdValue
            });
        }
    }
}

console.log(`\nTotal packets: ${packets.length}`);
console.log(`TX packets: ${packets.filter(p => p.direction === 'TX').length}`);
console.log(`RX packets: ${packets.filter(p => p.direction === 'RX').length}`);

// Count commands by type
const cmdCounts = {};
packets.forEach(p => {
    const key = `${p.direction} ${p.command}`;
    cmdCounts[key] = (cmdCounts[key] || 0) + 1;
});

console.log('\n--- Command Frequency ---');
Object.entries(cmdCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cmd, count]) => {
        console.log(`${cmd.padEnd(15)} : ${count}`);
    });

// Find the keepalive/polling pattern
console.log('\n--- Repeating Pattern Analysis ---');

// Look for sequences that repeat
const txCommands = packets.filter(p => p.direction === 'TX').map(p => p.command);
const patterns = [];

// Check for common sequences
for (let len = 3; len <= 8; len++) {
    const sequenceCounts = {};
    for (let i = 0; i <= txCommands.length - len; i++) {
        const seq = txCommands.slice(i, i + len).join(' -> ');
        sequenceCounts[seq] = (sequenceCounts[seq] || 0) + 1;
    }

    // Find sequences that repeat 3+ times
    const repeating = Object.entries(sequenceCounts)
        .filter(([seq, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1]);

    if (repeating.length > 0) {
        patterns.push({ length: len, sequences: repeating });
    }
}

if (patterns.length > 0) {
    patterns.forEach(({ length, sequences }) => {
        console.log(`\nSequences of ${length} commands:`);
        sequences.slice(0, 3).forEach(([seq, count]) => {
            console.log(`  [${count}x] ${seq}`);
        });
    });
}

// Show timeline of key events
console.log('\n--- Event Timeline (Command 0xBD PEQ packets) ---');
const bdPackets = packets.filter(p => p.cmdValue === 0xBD);
bdPackets.forEach((p, idx) => {
    console.log(`${idx + 1}. Line ${p.line}: ${p.direction} Command 0xBD`);
});

console.log('\n--- EQ Configuration Commands ---');
const eqCommands = [0x4F, 0x50, 0xBD, 0x4A, 0x16];
eqCommands.forEach(cmd => {
    const cmdHex = '0x' + cmd.toString(16).toUpperCase();
    const pkts = packets.filter(p => p.cmdValue === cmd);
    if (pkts.length > 0) {
        console.log(`Command ${cmdHex}: ${pkts.length} packets (${pkts.filter(p => p.direction === 'TX').length} TX, ${pkts.filter(p => p.direction === 'RX').length} RX)`);
    }
});
