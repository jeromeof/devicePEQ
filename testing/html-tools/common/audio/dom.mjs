// Thin DOM helpers shared by every module in this tool. Kept deliberately small:
// anything with domain meaning belongs in the audio modules beside this one.

export const $ = (id) => document.getElementById(id);

/** Current value of a form control, by id. */
export const value = (id) => $(id).value;

/** Numeric value of a control, falling back when the field is empty or invalid. */
export function number(id, fallback) {
  const n = Number(value(id));
  return Number.isFinite(n) ? n : fallback;
}

export const checked = (id) => $(id).checked;

/** Write a status line, flagging it as an error when something went wrong. */
export function setStatus(id, text, isError = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/** Write markup only when it actually changed — avoids reflow on hot paths. */
export function setHtml(id, html) {
  const el = $(id);
  if (el.innerHTML !== html) el.innerHTML = html;
}

export const on = (id, event, handler) => $(id).addEventListener(event, handler);
