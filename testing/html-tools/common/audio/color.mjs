/** #rrggbb plus alpha -> rgba(), so one palette drives both lines and fills. */
export function rgba(hex, alpha) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})` : hex;
}
