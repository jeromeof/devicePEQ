const fs = require('fs');
const content = fs.readFileSync('eq_change.txt', 'utf8');

// Extract all hex lines
const hexLines = content.match(/^Hex: (.+)$/gm);
console.log('Total packets captured:', hexLines.length);

// Look for the query pattern
const queries = hexLines.filter(h => h.includes('05 5A 06 00 00 0A'));
console.log('\nQuery packets (05 5A 06 00 00 0A XX ...):', queries.length);
console.log('Sample queries:');
queries.slice(0, 10).forEach(q => console.log('  ', q));

// Look for the response pattern
const responses = hexLines.filter(h => h.includes('05 5B BD 00 00 0A'));
console.log('\nResponse packets (05 5B BD 00 00 0A ...):', responses.length);
console.log('Sample responses (first 80 chars):');
responses.slice(0, 5).forEach(r => console.log('  ', r.substring(0, 80)));

// Analyze the query pattern more
console.log('\n=== ANALYSIS ===');
console.log('The app is polling presets continuously:');
const uniqueQueries = new Set();
queries.forEach(q => {
  const match = q.match(/Hex: (05 5A 06 00 00 0A [0-9A-F]{2})/);
  if (match) uniqueQueries.add(match[1]);
});
console.log('Unique query prefixes (without counter):');
Array.from(uniqueQueries).sort().forEach(q => console.log('  ', q));

console.log('\nConclusion: These packets should be filtered as keepalive polling!');
