// Minimal ZIP writer — stored (uncompressed) entries only.
//
// REW imports one measurement per file, so a positional set is five files. Rather
// than firing five downloads (which browsers throttle and prompt about), we pack
// them into one archive. Store-only keeps this to a page of code with no
// dependency; the payload is short ASCII and compresses little in practice.

const LOCAL_SIG = 0x04034b50, CENTRAL_SIG = 0x02014b50, EOCD_SIG = 0x06054b50;
const VERSION = 20, UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time, which every unzip implementation expects. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * @param {Array<{name:string, text:string}>} files
 * @returns {Blob} a ZIP archive
 */
export function createZip(files, when = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosStamp(when);
  const parts = [], central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true);            // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size == uncompressed
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // no extra field
    local.set(nameBytes, 30);

    const entry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);      // where the local header lives
    entry.set(nameBytes, 46);

    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
