// Download helpers. Kept separate from the audio maths so a headless or test
// context can import the maths without touching the DOM.

export function downloadBlob(filename, blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export function downloadText(filename, text, mime = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}
