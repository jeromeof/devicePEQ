// The response graph: axis scaling, drawing, zoom/pan and the hover readout.
//
// The chart knows nothing about targets, calibration or the capture workflow. The
// app hands it a *model* — curves plus a few callbacks describing what to draw —
// and the chart decides how to put that on a canvas.
//
// Model shape:
//   { curves:[{def,response}], centerCurve, axisLabel, spanDb,
//     targetLine:f=>db|null, zeroLine:bool,
//     bounds:{ at:f=>({hi,lo}), base:f=>db }|null, emptyRange:{ymin,ymax,step} }

import { responseDbAt, compareResponses } from '../common/audio/frequency-response.mjs';
import { FULL_RANGE, logSamples, axisTicks, tickLabel, fitVerticalRange, formatHz } from '../common/audio/axis.mjs';
import { rgba } from '../common/audio/color.mjs';

const PAD = { l: 62, r: 20, t: 22, b: 48 };
const BG = '#191919', GRID = '#353535', AXIS_TEXT = '#999', TARGET = '#f5c542';
const MIN_DECADES_ON_SCREEN = 0.03; // never zoom past ~7% of a decade

export function createChart({ canvas, getModel, onViewChange = () => {} }) {
  // dbMin/dbMax stay null while the axis autoscales; panning or a fixed span pins them.
  const view = { fMin: FULL_RANGE.fMin, fMax: FULL_RANGE.fMax, dbMin: null, dbMax: null };
  let geometry = null;   // last-rendered plot metrics, needed by the pointer maths
  let hover = null;      // cursor position in canvas pixels
  let base = null;       // offscreen copy of the chart, reused while hovering
  let paintQueued = false;

  // ------------------------------------------------------------------ geometry

  const xOf = (f) => PAD.l + Math.log10(Math.max(view.fMin, Math.min(view.fMax, f)) / view.fMin)
    / Math.log10(view.fMax / view.fMin) * geometry.pw;
  const yOf = (db) => PAD.t + (geometry.ymax - db) / (geometry.ymax - geometry.ymin) * geometry.ph;

  const freqAtX = (px) => {
    const t = Math.max(0, Math.min(1, (px - PAD.l) / geometry.pw));
    return view.fMin * Math.pow(view.fMax / view.fMin, t);
  };
  const dbAtY = (py) => geometry.ymax - ((py - PAD.t) / geometry.ph) * (geometry.ymax - geometry.ymin);

  function canvasPoint(event) {
    const r = canvas.getBoundingClientRect();
    return { x: (event.clientX - r.left) * canvas.width / r.width, y: (event.clientY - r.top) * canvas.height / r.height };
  }
  const inPlot = (p) => geometry && p.x >= PAD.l && p.x <= PAD.l + geometry.pw && p.y >= PAD.t && p.y <= PAD.t + geometry.ph;

  /** Fit the dB axis to everything visible in the current frequency window. */
  function verticalRange(model) {
    if (view.dbMin != null && view.dbMax != null) {
      const span = view.dbMax - view.dbMin;
      return { ymin: view.dbMin, ymax: view.dbMax, step: fitVerticalRange(view.dbMin, view.dbMax, span).step };
    }
    let min = Infinity, max = -Infinity;
    const seen = (db) => { if (Number.isFinite(db)) { if (db < min) min = db; if (db > max) max = db; } };
    for (const c of model.curves)
      for (let i = 0; i < c.response.magnitude.length; i++) {
        const f = c.response.startFreq + i * c.response.freqStep;
        if (f >= view.fMin && f <= view.fMax) seen(c.response.magnitude[i]);
      }
    if (model.targetLine || model.bounds) for (const f of logSamples(view.fMin, view.fMax, 200)) {
      const anchor = model.targetLine ? model.targetLine(f) : (model.bounds ? model.bounds.base(f) : null);
      if (model.targetLine) seen(anchor);
      const b = model.bounds?.at(f);
      if (b) { seen(model.bounds.base(f) + b.hi); seen(model.bounds.base(f) + b.lo); }
    }
    return fitVerticalRange(min, max, model.spanDb) || model.emptyRange;
  }

  // ------------------------------------------------------------------- drawing

  const trace = (ctx, points, toY) => {
    ctx.beginPath();
    points.forEach((p, i) => { const px = xOf(p.f ?? p), py = yOf(toY(p)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  };

  /** Fill the area between two series and outline it. */
  function fillBetween(ctx, points, upper, lower, fill, stroke) {
    trace(ctx, points, upper);
    for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(xOf(points[i].f), yOf(lower(points[i])));
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function drawGrid(ctx, model) {
    const { w, h, ymin, ymax, step } = geometry;
    ctx.font = '12px system-ui'; ctx.strokeStyle = GRID; ctx.fillStyle = AXIS_TEXT; ctx.lineWidth = 1;
    for (const f of axisTicks(view.fMin, view.fMax)) {
      const xx = xOf(f);
      ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, PAD.t + geometry.ph); ctx.stroke();
      ctx.fillText(tickLabel(f), xx - 10, h - 24);
    }
    for (let db = Math.ceil(ymin / step) * step; db <= ymax; db += step) {
      const yy = yOf(db);
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(w - PAD.r, yy); ctx.stroke();
      ctx.fillText(`${+db.toFixed(1)}`, 8, yy + 4);
    }
    ctx.fillStyle = '#9ad'; ctx.fillText(model.axisLabel, PAD.l, 15);
  }

  /** Each offset shaded against the centre average, in whatever space the view uses. */
  function drawSpread(ctx, model) {
    if (!model.centerCurve) return;
    for (const c of model.curves) {
      if (c.def.id === 'center') continue;
      const band = compareResponses(model.centerCurve, c.response);
      fillBetween(ctx, band, (p) => p.a, (p) => p.b, rgba(c.def.color, 0.26), rgba(c.def.color, 0.5));
    }
  }

  function drawBounds(ctx, model) {
    if (!model.bounds) return;
    const pts = logSamples(view.fMin, view.fMax, 500).map((f) => {
      const b = model.bounds.at(f), anchor = model.bounds.base(f);
      return { f, hi: anchor + b.hi, lo: anchor + b.lo };
    });
    fillBetween(ctx, pts, (p) => p.hi, (p) => p.lo, 'rgba(245,197,66,.10)');
    ctx.strokeStyle = 'rgba(245,197,66,.45)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    for (const key of ['hi', 'lo']) { trace(ctx, pts, (p) => p[key]); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  function drawTarget(ctx, model) {
    if (model.targetLine) {
      const samples = logSamples(view.fMin, view.fMax, 500).map((f) => ({ f }));
      trace(ctx, samples, (p) => model.targetLine(p.f));
      ctx.strokeStyle = TARGET; ctx.lineWidth = 2; ctx.stroke();
      return;
    }
    if (!model.zeroLine) return;
    // The tilt is already folded into the target the curves are measured against,
    // so in this view it is the flat 0 dB line — there is nothing else to draw.
    const yy = yOf(0);
    ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(geometry.w - PAD.r, yy);
    ctx.strokeStyle = TARGET; ctx.lineWidth = 2; ctx.stroke();
  }

  function drawCurves(ctx, model) {
    for (const c of model.curves) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < c.response.magnitude.length; i++) {
        const f = c.response.startFreq + i * c.response.freqStep;
        if (f < view.fMin || f > view.fMax) continue;
        const py = yOf(c.response.magnitude[i]);
        if (started) ctx.lineTo(xOf(f), py); else { ctx.moveTo(xOf(f), py); started = true; }
      }
      ctx.strokeStyle = c.def.color; ctx.lineWidth = c.def.id === 'center' ? 3 : 2; ctx.stroke();
    }
  }

  /** Crosshair plus a per-curve dB readout at the cursor frequency. */
  function drawHover(ctx) {
    if (!hover || !geometry || !inPlot(hover)) return;
    const f = freqAtX(hover.x);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(hover.x, PAD.t); ctx.lineTo(hover.x, PAD.t + geometry.ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.l, hover.y); ctx.lineTo(PAD.l + geometry.pw, hover.y); ctx.stroke();
    ctx.setLineDash([]);

    const rows = [[formatHz(f), '#fff']];
    for (const c of geometry.curves) {
      const db = responseDbAt(c.response, f);
      if (Number.isFinite(db)) rows.push([`${c.def.label} ${db.toFixed(1)} dB`, c.def.color]);
    }
    rows.push([`cursor ${dbAtY(hover.y).toFixed(1)} dB`, '#9ad']);

    ctx.font = '12px system-ui';
    const boxW = Math.max(...rows.map((r) => ctx.measureText(r[0]).width)) + 16, boxH = rows.length * 16 + 10;
    const bx = Math.min(hover.x + 12, PAD.l + geometry.pw - boxW), by = Math.min(hover.y + 12, PAD.t + geometry.ph - boxH);
    ctx.fillStyle = 'rgba(20,20,20,.88)'; ctx.strokeStyle = '#4a4a4a';
    ctx.beginPath(); ctx.rect(bx, by, boxW, boxH); ctx.fill(); ctx.stroke();
    rows.forEach(([text, color], i) => { ctx.fillStyle = color; ctx.fillText(text, bx + 8, by + 18 + i * 16); });
    ctx.restore();
  }

  // --------------------------------------------------------------- render loop

  /** Redraw the chart into the offscreen buffer, then composite. */
  function render() {
    const model = getModel();
    const w = canvas.width, h = canvas.height;
    if (!base || base.width !== w || base.height !== h) { base = document.createElement('canvas'); base.width = w; base.height = h; }
    const ctx = base.getContext('2d');
    geometry = { w, h, pw: w - PAD.l - PAD.r, ph: h - PAD.t - PAD.b, curves: model.curves };
    Object.assign(geometry, verticalRange(model));

    ctx.clearRect(0, 0, w, h); ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, model);
    drawSpread(ctx, model);
    drawBounds(ctx, model);
    drawTarget(ctx, model);
    drawCurves(ctx, model);
    paint();
  }

  /** Blit the cached chart and lay the crosshair over it — no recompute, no DOM writes. */
  function paint() {
    if (!base) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    drawHover(ctx);
  }

  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paint(); });
  }

  // -------------------------------------------------------------- view control

  function setView(next) { Object.assign(view, next); render(); onViewChange(view); }
  function reset() { setView({ ...FULL_RANGE, dbMin: null, dbMax: null }); }
  function clearDbLock() { view.dbMin = null; view.dbMax = null; render(); onViewChange(view); }

  /** Zoom the frequency axis about a fixed point; factor < 1 zooms in. */
  function zoom(factor, aboutHz = Math.sqrt(view.fMin * view.fMax)) {
    const centre = Math.log10(aboutHz);
    let lo = centre + (Math.log10(view.fMin) - centre) * factor;
    let hi = centre + (Math.log10(view.fMax) - centre) * factor;
    lo = Math.max(Math.log10(FULL_RANGE.fMin), lo);
    hi = Math.min(Math.log10(FULL_RANGE.fMax), hi);
    if (hi - lo < MIN_DECADES_ON_SCREEN) return;
    setView({ fMin: Math.pow(10, lo), fMax: Math.pow(10, hi) });
  }

  // Deliberately no wheel handler: the canvas sits in the page's scroll path, so a
  // scroll aimed at the page must never rescale the graph.
  function wirePointer() {
    let drag = null;
    canvas.addEventListener('pointerleave', () => { hover = null; schedulePaint(); });
    canvas.addEventListener('dblclick', reset);
    canvas.addEventListener('pointerdown', (e) => {
      if (!geometry) return;
      drag = { p: canvasPoint(e), fMin: view.fMin, fMax: view.fMax, ymin: geometry.ymin, ymax: geometry.ymax };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      hover = canvasPoint(e);
      if (!drag) { schedulePaint(); return; }
      const decades = Math.log10(drag.fMax / drag.fMin);
      const shift = -((hover.x - drag.p.x) / geometry.pw) * decades;
      let lo = Math.log10(drag.fMin) + shift, hi = Math.log10(drag.fMax) + shift;
      const width = hi - lo;
      if (lo < Math.log10(FULL_RANGE.fMin)) { lo = Math.log10(FULL_RANGE.fMin); hi = lo + width; }
      if (hi > Math.log10(FULL_RANGE.fMax)) { hi = Math.log10(FULL_RANGE.fMax); lo = hi - width; }
      const dDb = ((hover.y - drag.p.y) / geometry.ph) * (drag.ymax - drag.ymin);
      setView({ fMin: Math.pow(10, lo), fMax: Math.pow(10, hi), dbMin: drag.ymin + dDb, dbMax: drag.ymax + dDb });
    });
    const endDrag = (e) => {
      if (!drag) return;
      drag = null;
      canvas.style.cursor = 'crosshair';
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  wirePointer();

  return {
    view,
    render,
    setView,
    reset,
    clearDbLock,
    zoom,
    isFullSpan: () => view.fMin === FULL_RANGE.fMin && view.fMax === FULL_RANGE.fMax,
    isDefaultView: () => view.fMin === FULL_RANGE.fMin && view.fMax === FULL_RANGE.fMax && view.dbMin == null,
    /** The clean chart without the crosshair — what an export should contain. */
    snapshot: () => base || canvas,
  };
}
