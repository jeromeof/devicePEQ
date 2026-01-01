// Copyright 2025 : Pragmatic Audio

/**
 * TreblizerPEQ Plugin
 *
 * Recreates the Treble Smoothing Studio (treblePeakKiller.html) as a plugin overlay,
 * styled consistently with visualizePEQ/subjectizePEQ.
 *
 * Features:
 * - Sweep Analyzer (4–16 kHz, 2–60 s, marks)
 * - Revisit / Fine Tune: ERB-based (recommended) and PEQ Sweep-based methods
 * - Graph with current filter curve and moving microSweep dot
 * - Loads current PEQ filters from host; lets user select a target filter to revisit
 * - Save current treble peak killer settings back to the selected PEQ filter
 * - Apply button to push back to host (mirrors SubjectizePEQ Apply)
 * - Standalone responsive CSS; fullscreen on mobile
 */

// Import tuning controllers
import {
  ERBTuningController,
  ERB_BANDS,
  ERB_INFO,
  calculateERB
} from './erbTuning.js';

import {
  SweepFineTuningController,
  TwoToneReferenceController,
  SWEEP_INFO,
  calculateStepHz,
  calculatePercentBounds,
  WARBLE_RATE_HZ,
  WARBLE_DEPTH,
  REF_LEVEL
} from './sweepFineTuning.js';

// Context-specific info for each fine-tuning method
const ERB_TUNING_INFO = {
  title: "ERB Volume Levelling",
  summary: "Match the loudness of ERB frequency bands to a neutral midrange reference.",
  details: `**How it works:**
• Sound alternates every 2 seconds between reference (neutral midrange) and the selected ERB band
• The reference is typically 900 Hz (neutral midrange), but can be changed in Advanced Mode
• Each ERB band represents a perceptual frequency region

**What to listen for:**
🎧 **Ask yourself:** Does this ERB region feel **stronger** or **weaker** than the neutral midrange?
→ Adjust the slider until both feel equally loud

**The four ERB bands:**
• **Lower Presence** (4.5-7 kHz): Vocal warmth and body
• **Upper Presence** (6-8.5 kHz): Sibilance control
• **Brilliance** (8-12 kHz): Sharpness and glare
• **Air** (12-20 kHz): Openness and extension

**Why ERB?** These bands match your ear's natural frequency integration, avoiding over-compensation for individual ear resonances.`
};

const TONE_3_INFO = {
  title: "3-Tone Method",
  summary: "Cycles between lower, center, and upper frequency bounds to help you identify the exact frequency peak.",
  details: `**How it works:**
• Plays three tones in sequence: Lower → Center → Upper
• Each tone is affected by your current PEQ filter settings
• Use the Center Frequency and ±Range sliders to narrow down the problem area

**What to listen for:**
1. Which tone sounds most prominent or harsh?
2. Adjust Center Frequency to focus on the loudest tone
3. Reduce ±Range to narrow down the exact frequency
4. Adjust Q and Gain to smooth out the peak

**Best for:** Identifying and targeting specific treble peaks with precision.`
};

const TONE_MICROSWEEP_INFO = {
  title: "MicroSweep Method",
  summary: "Smooth frequency sweep within the filter bandwidth to reveal peaks naturally.",
  details: `**How it works:**
• Sweeps smoothly through the frequency range around your center frequency
• The sweep range is determined by your ±Range setting
• The tone "glides" through the frequencies continuously

**What to listen for:**
1. Does the tone get louder at certain frequencies as it sweeps?
2. Listen for moments where the tone becomes harsh or piercing
3. Those moments indicate frequency peaks that need reduction

**Best for:** Getting a natural feel for how the frequency region responds, without discrete steps.`
};

const TONE_NARROWBAND_INFO = {
  title: "Narrow Band (2-Tone) Method",
  summary: "Compares a reference tone with your center frequency to detect if it's too prominent.",
  details: `**How it works:**
• Alternates between a reference frequency (default: 500 Hz midrange) and your center frequency
• Both tones are narrow-band pink noise, not pure sine waves
• Bandwidth can be adjusted (default: 0.33 octaves)

**What to listen for:**
1. Does the center frequency sound louder than the reference?
2. If yes, it's a peak that needs reduction (negative gain)
3. If no, it may need boosting or is already level

**Best for:** Comparing specific frequency regions to a neutral reference, similar to ERB method but more surgical.

**Advanced:** You can change the reference frequency and noise bandwidth in Advanced Mode.`
};

const TONE_WARBLE_INFO = {
  title: "Warble Method",
  summary: "FM-modulated tone that makes peaks easier to detect by ear.",
  details: `**How it works:**
• Creates a tone that frequency-modulates (warbles) around your center frequency
• The warble rate is ${WARBLE_RATE_HZ} Hz with depth of ${WARBLE_DEPTH}%
• This modulation makes harsh peaks more obvious to human hearing

**What to listen for:**
1. Does the warbling tone sound harsh, buzzy, or unpleasant?
2. Harshness indicates a peak at or near the center frequency
3. The warble makes it easier to detect subtle peaks

**Best for:** Making subtle treble peaks more obvious through frequency modulation. Some users find this more revealing than static tones.`
};

export default async function initializeTreblizerPEQPlugin(context) {
  console.log('TreblizerPEQ Plugin initialized with context:', context);

  const cfg = (context && context.config) || {};
  let placement = 'afterend';
  let anchorSelector = '.extra-eq';
  if (cfg && typeof cfg.treblizerPEQPlacement === 'string') placement = cfg.treblizerPEQPlacement;
  if (cfg && typeof cfg.treblizerPEQAnchorDiv === 'string') anchorSelector = cfg.treblizerPEQAnchorDiv;

  function resolveAnchor() {
    if (anchorSelector) {
      const el = document.querySelector(anchorSelector);
      if (el) return el;
    }
    return (
      document.querySelector('.extra-eq') ||
      document.getElementById('peq-controls') ||
      document.body
    );
  }

  // Common plugin controls container
  function ensureCommonControlsContainer() {
    let c = document.getElementById('peqPluginControls');
    if (c) return c;
    c = document.createElement('div');
    c.id = 'peqPluginControls';
    c.className = 'peq-plugin-controls';
    const cssId = 'peqPluginControlsCSS';
    if (!document.getElementById(cssId)) {
      const s = document.createElement('style');
      s.id = cssId;
      s.textContent = `
        #peqPluginControls.peq-plugin-controls { display:inline-flex; gap:8px; align-items:center; flex-wrap:wrap; margin:8px 0; }
        #peqPluginControls .peq-plugin-btn { margin:0; vertical-align:middle; }
      `;
      document.head.appendChild(s);
    }
    // Use configurable common container anchor/placement
    const cfg = (context && context.config) || {};
    const anchorSel = cfg.peqPluginControlsAnchorDiv || '.extra-eq';
    const place = cfg.peqPluginControlsPlacement || 'afterend';
    const anchor = document.querySelector(anchorSel) || document.body;
    if (anchor && typeof anchor.insertAdjacentElement === 'function') {
      anchor.insertAdjacentElement(place, c);
    } else if (anchor && anchor.parentElement) {
      anchor.parentElement.appendChild(c);
    } else {
      document.body.appendChild(c);
    }
    return c;
  }

  // Add a Treblizer button alongside others inside the common container
  const trebBtn = document.createElement('button');
  trebBtn.textContent = 'Treblizer';
  trebBtn.className = 'treblizerPEQ-control-btn peq-plugin-btn';
  const controls = ensureCommonControlsContainer();
  controls.appendChild(trebBtn);

  // Overlay elements
  let overlayBackdrop = null;
  let overlay = null;

  // Internal state of PEQ filters loaded from host
  let peqFilters = [];
  let selectedFilterIndex = -1; // which filter from peqFilters user is targeting

  // Sweep range (configurable via cookie)
  let sweepFStart = 4000;
  let sweepFEnd = 16000;

  function setCookie(name, value, days=365) {
    try {
      const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000));
      document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
    } catch (_) {}
  }
  function getCookie(name) {
    try {
      const cname = name + '=';
      const parts = (document.cookie||'').split(';');
      for (let c of parts) {
        c = c.trim();
        if (c.indexOf(cname) === 0) return decodeURIComponent(c.substring(cname.length));
      }
    } catch (_) {}
    return null;
  }

  function loadSweepRangeFromCookie(){
    const v = getCookie('treblizerSweepRange');
    if (!v) return;
    const bits = v.split(',').map(Number);
    if (bits.length===2 && isFinite(bits[0]) && isFinite(bits[1]) && bits[0]>0 && bits[1]>bits[0]){
      sweepFStart = Math.max(20, Math.round(bits[0]));
      sweepFEnd = Math.min(24000, Math.round(bits[1]));
    }
  }

  loadSweepRangeFromCookie();

  // Audio state (scoped within plugin)
  let audioCtx = null;
  let outPreGain = null;
  let outLimiter = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!outPreGain) {
      outPreGain = audioCtx.createGain();
      outPreGain.gain.value = 0.25; // -12 dB headroom
    }
    if (!outLimiter) {
      outLimiter = audioCtx.createDynamicsCompressor();
      try {
        outLimiter.threshold.setValueAtTime(-1.0, audioCtx.currentTime);
        outLimiter.knee.setValueAtTime(0.0, audioCtx.currentTime);
        outLimiter.ratio.setValueAtTime(20.0, audioCtx.currentTime);
        outLimiter.attack.setValueAtTime(0.003, audioCtx.currentTime);
        outLimiter.release.setValueAtTime(0.05, audioCtx.currentTime);
      } catch (e) {}
      outPreGain.connect(outLimiter).connect(audioCtx.destination);
    }
  }

  // RBJ peaking EQ magnitude using Q
  function biquadMagQ(fc, gain, Q, f) {
    if (!(Q > 0)) return 0;
    const A = Math.pow(10, gain / 40);
    const w0 = 2 * Math.PI * (fc / 48000);
    const alpha = Math.sin(w0) / (2 * Q);
    const b0 = 1 + alpha * A;
    const b1 = -2 * Math.cos(w0);
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha / A;
    const w = 2 * Math.PI * f / 48000;
    const cosw = Math.cos(w);
    const sinw = Math.sin(w);
    const cos2w = Math.cos(2 * w);
    const sin2w = Math.sin(2 * w);
    const Nr = b0 + b1 * cosw + b2 * cos2w;
    const Ni = b1 * sinw + b2 * sin2w;
    const Dr = a0 + a1 * cosw + a2 * cos2w;
    const Di = a1 * sinw + a2 * sin2w;
    const num = Nr * Nr + Ni * Ni;
    const den = Dr * Dr + Di * Di;
    const H2 = den > 0 ? num / den : 1;
    return 20 * Math.log10(Math.max(1e-6, Math.sqrt(H2)));
  }

  // Convert octave bandwidth to Q for bandpass filter
  function octaveBWToQ(oct) {
    return 1 / (2 * Math.sinh(Math.log(2) * oct / 2));
  }

  function totalEQGainAtFreq(f) {
    if (!Array.isArray(peqFilters) || peqFilters.length === 0) return 0;
    let sum = 0;
    for (const b of peqFilters) {
      if (b.disabled) continue;
      // Ignore filters that are out of the active Treblizer sweep range for graph visuals
      if (!(b.fc >= sweepFStart && b.fc <= sweepFEnd)) continue;
      const qVal = Math.max(0, Number(b.q || b.Q || 0));
      const g = Number(b.gain || b.G || 0);
      const fc = Number(b.fc || b.freq || 1000);
      sum += biquadMagQ(fc, g, qVal, f);
    }
    return sum;
  }

  // Build the overlay DOM and wire UI
  function openOverlay() {
    // Load filters from host, attaching index for round-trip
    try {
      if (context && typeof context.elemToFilters === 'function') {
        const src = context.elemToFilters(true) || [];
        peqFilters = src.map((f, i) => ({
          type: f.type || 'PK',
          fc: Number(f.freq || f.fc || 1000),
          gain: Number(f.gain || 0),
          q: Number(f.q != null ? f.q : f.Q != null ? f.Q : 1),
          disabled: !!f.disabled,
          index: i
        }));
      }
    } catch (e) {
      console.warn('Treblizer: failed to pull filters from host', e);
      peqFilters = [];
    }

    overlayBackdrop = document.createElement('div');
    overlayBackdrop.className = 'peq-overlay-backdrop';
    overlayBackdrop.addEventListener('click', (e) => { if (e.target === overlayBackdrop) closeOverlay(); });

    overlay = document.createElement('div');
    overlay.className = 'peq-overlay treblizer';

    // styles
    const style = document.createElement('style');
    style.textContent = `
      .treblizerPEQ-control-btn { margin-right: 8px; }
      .peq-overlay-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9998; }
      .peq-overlay.treblizer { position:fixed; inset:0; margin:auto; width:95vw; max-width:1200px; height:90vh; background:#16181b; color:#e3e3e3; border:1px solid #333; border-radius:8px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:9999; }
      .peq-overlay-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid #333; }
      .treb-body { flex:1; display:grid; grid-template-columns:330px 1fr 420px; gap:14px; padding:14px; overflow:auto; }
      .treb-panel { background:#1f2226; border:1px solid #2c3035; border-radius:8px; box-shadow:0 3px 12px rgba(0,0,0,0.45); padding:12px; overflow:hidden; }
      /* Allow the Revisit panel to scroll if content gets taller than viewport */
      /* Revisit panel must be a flex column so inner sections can scroll on mobile */
      .treb-panel.revisit-panel { display:flex; flex-direction:column; overflow:auto; min-height:0; }
      .treb-panel h2 { margin:4px 0 10px; font-size:16px; }
      .treb-label { font-size:12px; color:#9ea2a8; margin:6px 0; display:block; }
      .treb-panel input[type=range] { width:100%; }
      .treb-table { width:100%; border-collapse:collapse; font-size:12px; }
      .treb-table th { background:#25292e; text-align:left; padding:6px; }
      .treb-table td { border-bottom:1px solid #2c3035; padding:6px; }
      .treb-btn { background:#3fa9f5; color:#fff; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; margin:4px 6px 0 0; }
      .treb-btn.secondary { background:#555; }
      .treb-btn.success { background:#3fd96a; }
      .treb-btn.warn { background:#f5b83f; color:#111; }
      .treb-btn.danger { background:#d94040; }
      .treb-canvas { width:100%; height:100%; background:#0f1113; border-radius:8px; border:1px solid #2c3035; }
      .treb-hud { position:absolute; right:20px; bottom:20px; background:rgba(30,32,36,0.85); padding:8px 12px; border-radius:8px; border:1px solid #2c3035; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; }
      /* Old floating filters panel (no longer used) */
      .treb-filters-panel { display:none; }
      /* Inline filters section inside Revisit panel */
      .treb-filter-list { max-height: 220px; overflow: auto; border:1px solid #2c3035; border-radius:6px; padding:4px; background:#101215; }

      /* Ensure Treblizer radios are always visible/enabled regardless of global CSS */
      .peq-overlay.treblizer input[type="radio"],
      .treb-panel input[type="radio"] {
        -webkit-appearance: radio !important;
        appearance: auto !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        width: auto !important;
        height: auto !important;
        position: static !important;
        visibility: visible !important;
      }
      /* Ensure Treblizer checkboxes are always visible/enabled regardless of global CSS */
      .peq-overlay.treblizer input[type="checkbox"],
      .treb-panel input[type="checkbox"] {
        -webkit-appearance: checkbox !important;
        appearance: auto !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        width: auto !important;
        height: auto !important;
        position: static !important;
        visibility: visible !important;
      }
      .treb-filter-row { display:grid; grid-template-columns: 1fr auto auto; align-items:center; column-gap:8px; padding:6px 8px; margin:2px 0; border-radius:6px; cursor:pointer; border:1px solid #2c3035; background: transparent; position: relative; }
      .treb-filter-row .badge { font-size:11px; color:#9ea2a8; }
      .treb-filter-row.selected { background: rgba(63,169,245,0.12); outline: 2px solid rgba(63,169,245,0.5); }
      .treb-filter-row.selected::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:#3fa9f5; border-top-left-radius:6px; border-bottom-left-radius:6px; }
      .treb-locked-wrap { margin-bottom:6px; display:none; }
      .treb-locked-title { font-size:12px; color:#9ea2a8; margin:0 0 4px 0; }
      .treb-locked-chips { display:flex; flex-wrap:wrap; gap:6px; }
      .treb-chip { font-size:11px; color:#f5d07a; background:rgba(245,184,63,0.12); border:1px solid rgba(245,184,63,0.35); border-radius:999px; padding:3px 8px; white-space:nowrap; }
      .treb-help { padding:6px 12px; background:rgba(28,30,34,0.95); border-top:1px solid #333; font-size:12px; color:#9ea2a8; }
      /* Action row (Start/Stop/Save) */
      .treb-action-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:10px 0 8px; flex-shrink:0; }
      .treb-action-row .treb-btn { margin:0; }
      .treb-select { width:100%; background:#101215; color:#e3e3e3; border:1px solid #2c3035; border-radius:4px; padding:6px; }
      /* Slider styling — simplified to match SubjectizePEQ, and SCOPED to Treblizer to avoid cross-plugin overrides */
      /* Ensure Treblizer's own slider groups are visible, without using !important */
      .peq-overlay.treblizer .revisit-panel .peq-sliders { display: block; }
      .peq-overlay.treblizer .peq-sliders { margin-top: 4px; }
      /* Default: hide Sweep Speed wrapper; JS will show it only in Advanced mode. Ensure full-width layout when shown */
      .peq-overlay.treblizer #advancedSweepSpeedWrapT { display: none; width: 100%; }
      .peq-overlay.treblizer #advancedSweepSpeedWrapT .slider-panel { grid-template-columns: 1fr !important; }
      .peq-overlay.treblizer #advancedSweepSpeedWrapT .slider-col { width: 100%; }
      /* Safety net to counter any external range input hiding */
      .peq-overlay.treblizer input[type=range].hrange { display: block; }
      /* Make each row of sliders an equal-width 2-column grid */
      .peq-overlay.treblizer .peq-sliders .slider-panel { display:grid !important; grid-template-columns: 1fr 1fr; gap:12px; align-items:flex-start; }
      .peq-overlay.treblizer .peq-sliders .slider-col { box-sizing:border-box; min-width:0 !important; width:100%; display:flex; flex-direction:column; gap:8px; }
      .peq-overlay.treblizer .peq-sliders .slider-col .head { display:flex; align-items:baseline; justify-content:space-between; }
      .peq-overlay.treblizer .peq-sliders .slider-col .head .label { font-size:12px; color:#9ea2a8; }
      .peq-overlay.treblizer .peq-sliders .slider-col .head .value { font-size:13px; color:#e3e3e3; font-variant-numeric: tabular-nums; }
      .peq-overlay.treblizer .hrange { -webkit-appearance: none; appearance: none; width: 100%; height: 44px; background: transparent; }
      .peq-overlay.treblizer .hrange::-webkit-slider-runnable-track { height: 18px; background: #333; border-radius: 9px; border: 1px solid #444; }
      .peq-overlay.treblizer .hrange::-moz-range-track { height: 18px; background: #333; border-radius: 9px; border: 1px solid #444; }
      .peq-overlay.treblizer .hrange::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 28px; height: 28px; border-radius: 50%; background: #ffcc00; border: 1px solid #b38f00; margin-top: -5px; }
      .peq-overlay.treblizer .hrange::-moz-range-thumb { width: 28px; height: 28px; border-radius: 50%; background: #ffcc00; border: 1px solid #b38f00; }
      .peq-overlay.treblizer .hrange:focus { outline: none; }
      .peq-overlay.treblizer .hrange:focus::-webkit-slider-runnable-track { box-shadow: 0 0 0 2px rgba(255,204,0,0.25); }
      .peq-overlay.treblizer .hrange:focus::-moz-range-track { box-shadow: 0 0 0 2px rgba(255,204,0,0.25); }
      .peq-overlay.treblizer .hrange::-webkit-slider-thumb:active { transform: scale(1.1); }
      /* Ensure the two rows in Revisit have consistent spacing */
      .peq-overlay.treblizer .peq-sliders .slider-panel + .slider-panel { margin-top: 10px; }

      /* Method section styling */
      .treb-method-section { transition: all 0.2s ease; }
      .treb-method-section:has(input[type="radio"]:checked) {
        border: 1px solid rgba(255,255,255,0.2);
      }

      /* Info button styling */
      .treb-btn-icon {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        color: #9ea2a8;
        cursor: pointer;
        font-size: 14px;
        padding: 2px 8px;
        transition: all 0.2s;
      }
      .treb-btn-icon:hover {
        background: rgba(255,255,255,0.05);
        color: #e3e3e3;
      }

      /* Info popup modal */
      .treb-info-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        z-index: 100001;
      }
      .treb-info-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #1f2226;
        border: 1px solid #2c3035;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        padding: 20px;
        z-index: 100002;
        color: #9ea2a8;
      }
      .treb-info-modal h3 {
        margin: 0 0 12px 0;
        color: #e3e3e3;
      }
      .treb-info-modal p {
        margin: 8px 0;
        color: #9ea2a8;
        line-height: 1.5;
      }
      .treb-info-modal div {
        color: #9ea2a8;
      }
      .treb-info-modal-close {
        float: right;
        font-size: 24px;
        cursor: pointer;
        color: #9ea2a8;
        line-height: 1;
      }
      .treb-info-modal-close:hover {
        color: #e3e3e3;
      }

      @media (max-width: 820px) {
        .peq-overlay.treblizer { width:100vw !important; height:100vh !important; max-width:none !important; border-radius:0 !important; }
        /* Single column layout; remove excessive bottom padding so buttons aren't cut */
        .treb-body { grid-template-columns: 1fr; grid-auto-rows: minmax(200px, auto); overflow:auto; padding-bottom: 16px; }
        /* Stack sliders to one column on narrow viewports */
        .peq-overlay.treblizer .peq-sliders .slider-panel { grid-template-columns: 1fr !important; }
        /* Reduce track height for small screens to save vertical space */
        .peq-overlay.treblizer .hrange { height: 36px; }
        .peq-overlay.treblizer .hrange::-webkit-slider-runnable-track { height: 12px; border-radius: 6px; }
        .peq-overlay.treblizer .hrange::-moz-range-track { height: 12px; border-radius: 6px; }
        /* Let the filters list expand to fill remaining space within Revisit panel */
        .treb-panel.revisit-panel { padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
        .treb-filter-list { max-height: none; flex: 1 1 auto; min-height: 160px; }
        #microSweepControlsT { flex-shrink: 0; }
      }
    `;
    document.head.appendChild(style);

    // Header with Apply + Close
    const header = document.createElement('div');
    header.className = 'peq-overlay-header';
    const title = document.createElement('div');
    title.id = 'trebOverlayTitle';
    title.textContent = 'Treblizer PEQ';
    title.style.fontWeight = '600';
    const headerBtns = document.createElement('div');
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.className = 'treb-btn';
    applyBtn.id = 'applyTreblizerPEQOverlay';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'treb-btn secondary';
    closeBtn.addEventListener('click', closeOverlay);
    // Advanced mode toggle (scoped to Treblizer only)
    const advWrap = document.createElement('label');
    advWrap.style.marginRight = '8px';
    advWrap.style.fontSize = '12px';
    advWrap.style.color = '#9ea2a8';
    advWrap.innerHTML = `<input type="checkbox" id="advancedModeT" style="vertical-align:middle; margin-right:6px; -webkit-appearance: checkbox; appearance: auto; opacity: 1;"> Advanced mode`;
    headerBtns.appendChild(advWrap);
    headerBtns.appendChild(applyBtn);
    headerBtns.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerBtns);

    const body = document.createElement('div');
    body.className = 'treb-body';

    // Left panel (Sweep Analyzer + marks)
    const left = document.createElement('div');
    left.className = 'treb-panel';
    left.innerHTML = `
      <h2>1. Sweep Analyzer</h2>
      <div class="treb-label">Sweep Range: <b id="sweepRangeLabelT"></b></div>
      <div id="advancedSweepControlsT" style="display:flex; gap:8px; align-items:center;">
        <label class="treb-label" style="margin:0;">Start (Hz):</label>
        <input type="number" id="sweepStartT" min="1000" max="20000" step="100" style="width:100px;background:#101215;color:#e3e3e3;border:1px solid #2c3035;border-radius:4px;padding:4px;">
        <label class="treb-label" style="margin:0;">End (Hz):</label>
        <input type="number" id="sweepEndT" min="2000" max="24000" step="100" style="width:100px;background:#101215;color:#e3e3e3;border:1px solid #2c3035;border-radius:4px;padding:4px;">
        <button class="treb-btn secondary" id="sweepRangeSaveT" title="Save as default (cookie)">Save</button>
      </div>
      <div id="advancedSweepSpeedWrapT" class="peq-sliders" style="margin-top:6px;">
        <div class="slider-panel">
          <div class="slider-col">
            <div class="head"><span class="label">Sweep Speed (seconds)</span><span class="value" id="sweepSpeedLabelT">40</span></div>
            <input type="range" id="sweepSpeedT" class="hrange" min="2" max="60" value="40" step="1">
          </div>
        </div>
      </div>
      <span class="treb-label">Current Sweep Frequency: <b id="sweepFreqLabelT">—</b> Hz</span>
      <div id="sweepApplyWrapT"><label class="treb-label" style="margin-top:8px;"><input type="checkbox" id="sweepApplyFiltersT"> Apply Saved Filters during Sweep</label></div>
      <div>
        <button class="treb-btn" id="sweepStartBtnT">Start Sweep</button>
        <button class="treb-btn secondary" id="sweepStopBtnT">Stop</button>
        <button class="treb-btn warn" id="sweepMarkBtnT">Mark</button>
      </div>
      <h3 style="margin-top:16px;">Marked Treble Issues</h3>
      <div class="treb-label">Press <b>M</b> during sweep to mark an issue.</div>
      <table class="treb-table"><thead><tr><th>Freq (Hz)</th><th>Actions</th></tr></thead><tbody id="markTableT"></tbody></table>
    `;

    // Center panel (Graph)
    const center = document.createElement('div');
    center.className = 'treb-panel';
    center.style.position = 'relative';
    center.innerHTML = `<canvas id="eqCanvasT" class="treb-canvas"></canvas><div id="toneHUDT" class="treb-hud">Tone A — 7500 Hz</div>`;

    // Right panel (Revisit / Fine Tune + inline PEQ list)
    const right = document.createElement('div');
    right.className = 'treb-panel revisit-panel';
    right.innerHTML = `
      <h2>2. Revisit / Fine Tune</h2>

      <!-- Tuning Method Radio Buttons (Horizontal) -->
      <div style="display:flex; gap:12px; align-items:center; margin:12px 0 16px 0; flex-wrap:wrap;">
        <label class="treb-label" style="margin:0; font-weight:600; cursor:pointer;">
          <input type="radio" name="revisitModeT" id="modeERBBandsT" value="erbBands" checked style="margin-right:6px;">
          ERB Based
        </label>
        <button class="treb-btn-icon" id="erbInfoBtnT" title="Learn about ERB tuning" style="margin-left:-6px;">ℹ️</button>

        <label class="treb-label" style="margin:0 0 0 12px; font-weight:600; cursor:pointer;">
          <input type="radio" name="revisitModeT" id="modePEQSweepT" value="peqSweep" style="margin-right:6px;">
          PEQ Sweep Based
        </label>
        <button class="treb-btn-icon" id="sweepInfoBtnT" title="Learn about PEQ sweep tuning" style="margin-left:-6px;">ℹ️</button>
      </div>

      <!-- ERB Band Controls -->
      <div id="erbBandControlsT" style="display:block;">
        <div style="font-size:11px; color:#888; margin-bottom:8px;">Click ERB Band and adjust SPL to be level with reference 'midrange' ERB band</div>
        <div id="erbAdvancedControlsT" style="display:none; margin-bottom:8px;">
          <label class="treb-label" style="font-size:11px; color:#888;">
            Reference:
            <select id="erbReferenceSelectT" class="treb-select" style="width:auto; display:inline-block; margin-left:6px; padding:4px 8px; font-size:11px;">
              <option value="-1">900 Hz (midrange)</option>
              <option value="0">Lower Presence</option>
              <option value="1">Upper Presence</option>
              <option value="2">Brilliance</option>
              <option value="3">Air</option>
            </select>
          </label>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
          <div id="erbBandCard0T" class="erb-band-card" style="background:rgba(255,107,107,0.1); padding:8px; border-radius:4px; border:2px solid rgba(255,107,107,0.3); cursor:pointer;">
            <div class="head" style="margin-bottom:4px;"><span class="label" style="color:#FF6B6B; font-size:11px;">⬤ Lower Presence</span><span class="value"><b id="erbBand0LabelT">0.0</b> dB</span></div>
            <input type="range" id="erbBand0T" class="hrange" min="-12" max="12" value="0" step="0.5">
            <div style="font-size:10px; color:#999; margin-top:2px;">4.5-7 kHz</div>
          </div>
          <div id="erbBandCard1T" class="erb-band-card" style="background:rgba(255,165,0,0.1); padding:8px; border-radius:4px; border:2px solid transparent; cursor:pointer;">
            <div class="head" style="margin-bottom:4px;"><span class="label" style="color:#FFA500; font-size:11px;">⬤ Upper Presence</span><span class="value"><b id="erbBand1LabelT">0.0</b> dB</span></div>
            <input type="range" id="erbBand1T" class="hrange" min="-12" max="12" value="0" step="0.5">
            <div style="font-size:10px; color:#999; margin-top:2px;">6-8.5 kHz (sibilance)</div>
          </div>
          <div id="erbBandCard2T" class="erb-band-card" style="background:rgba(78,205,196,0.1); padding:8px; border-radius:4px; border:2px solid transparent; cursor:pointer;">
            <div class="head" style="margin-bottom:4px;"><span class="label" style="color:#4ECDC4; font-size:11px;">⬤ Brilliance</span><span class="value"><b id="erbBand2LabelT">0.0</b> dB</span></div>
            <input type="range" id="erbBand2T" class="hrange" min="-12" max="12" value="0" step="0.5">
            <div style="font-size:10px; color:#999; margin-top:2px;">8-12 kHz (sharpness)</div>
          </div>
          <div id="erbBandCard3T" class="erb-band-card" style="background:rgba(149,225,211,0.1); padding:8px; border-radius:4px; border:2px solid transparent; cursor:pointer;">
            <div class="head" style="margin-bottom:4px;"><span class="label" style="color:#95E1D3; font-size:11px;">⬤ Air</span><span class="value"><b id="erbBand3LabelT">0.0</b> dB</span></div>
            <input type="range" id="erbBand3T" class="hrange" min="-12" max="12" value="0" step="0.5">
            <div style="font-size:10px; color:#999; margin-top:2px;">12-20 kHz (openness)</div>
          </div>
        </div>
      </div>

      <!-- PEQ Sweep Controls -->
      <div id="peqSweepControlsT" style="display:none;">
          <!-- Sub-mode selection -->
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <label class="treb-label" style="margin:0; font-size:0.9em;">
              <input type="radio" name="peqSweepSubModeT" id="mode3TonePEQT" value="3tonePEQ" checked> 3‑Tone
            </label>
            <label class="treb-label" style="margin:0; font-size:0.9em;">
              <input type="radio" name="peqSweepSubModeT" id="modeMicroSweepT" value="microSweep"> microSweep
            </label>
            <label class="treb-label" style="margin:0; font-size:0.9em;">
              <input type="radio" name="peqSweepSubModeT" id="modeToneNarrowBandT" value="toneNarrowBand"> Narrow Band
            </label>
            <label class="treb-label" style="margin:0; font-size:0.9em;">
              <input type="radio" name="peqSweepSubModeT" id="modeToneWarbleT" value="toneWarble"> Warble
            </label>
          </div>
          <!-- 2x2 slider grid to mirror Visualizer/Subjectizer styles -->
          <div id="standardSlidersT" class="peq-sliders">
            <div class="slider-panel" style="margin-bottom:10px;">
              <!-- Row 1: Frequency and ±Range -->
              <div class="slider-col">
                <div class="head"><span class="label">Center Frequency (Hz)</span><span class="value" id="toneCenterLabelT">8000</span></div>
                <input type="range" id="toneCenterTT" class="hrange" min="4000" max="16000" value="8000" step="10">
              </div>
              <div class="slider-col">
                <div class="head"><span class="label">+- Range</span><span class="value"><span id="toneStepLabelT">10.00</span>% (<span id="toneStepHzLabelT">600</span> Hz)</span></div>
                <input type="range" id="toneStepTT" class="hrange" min="1" max="25" value="10.00" step="0.5">
              </div>
            </div>
            <div class="slider-panel">
              <!-- Row 2: Q and Gain -->
              <div class="slider-col">
                <div class="head"><span class="label">Q-Value</span><span class="value" id="toneQLabelT">4.00</span></div>
                <input type="range" id="toneQTT" class="hrange" min="0" max="10" value="4" step="0.01">
              </div>
              <div class="slider-col">
                <div class="head"><span class="label">Center Gain (dB)</span><span class="value" id="toneGainLabelT">0</span></div>
                <input type="range" id="toneGainTT" class="hrange" min="-12" max="12" value="0" step="0.5">
              </div>
            </div>
          </div>
          <div id="advancedToneControlsT" style="display:none; margin-top:4px;">
            <span class="treb-label">Reference Frequency (Hz): <b id="refFreqLabelT">500</b></span>
            <input type="range" id="refFreqT" class="hrange" min="100" max="2000" value="500" step="10">
            <span class="treb-label">Noise Bandwidth (Oct): <b id="noiseBWLabelT">0.33</b></span>
            <input type="range" id="noiseBWT" class="hrange" min="0.1" max="1.0" value="0.33" step="0.01">
          </div>
          <div id="microSweepControlsT" style="display:none; margin-top:4px;">
            <span class="treb-label">microSweep half‑cycle (sec): <b id="microSweepDurationLabelT">12</b></span>
            <input type="range" id="microSweepDurationT" class="hrange" min="6" max="30" value="12" step="1">
          </div>
        </div>
      </div>

      <!-- Actions row -->
      <div class="treb-action-row">
        <button class="treb-btn" id="toneStartBtnT">Start ERB Volume Levelling</button>
        <button class="treb-btn-icon" id="erbTuningInfoBtnT" title="What to listen for during tuning">ℹ️</button>
        <button id="saveFilterBtnT" class="treb-btn success" disabled>Save to Filter</button>
      </div>

      <!-- ERB Tuning Instructions (toggleable) -->
      <div id="erbTuningInstructionsT" style="display:none; background:rgba(63,169,245,0.08); border:1px solid rgba(63,169,245,0.2); border-radius:6px; padding:10px; margin:8px 0 12px 0;">
        <div style="font-size:11px; font-weight:600; color:#3fa9f5; margin-bottom:4px;">🎧 What to Listen For:</div>
        <div style="font-size:11px; color:#9ea2a8; line-height:1.4;">
          The sound will alternate between <b style="color:#e3e3e3;">reference</b> (neutral midrange) and the <b style="color:#e3e3e3;">selected ERB band</b>.<br>
          <b style="color:#FFD700;">Ask yourself:</b> Does this ERB region feel <b style="color:#FF6B6B;">stronger</b> or <b style="color:#4ECDC4;">weaker</b> than the neutral midrange?<br>
          → Adjust the slider until both feel equally loud.
        </div>
      </div>

      <h3 style="margin-top:12px;">Filters</h3>
      <div class="treb-label" style="margin:0 0 6px 0;">Click to select, or use Revisit</div>
      <div id="filterListT" class="treb-filter-list"></div>
      <div id="lockedWrapT" class="treb-locked-wrap" style="margin-top:8px;">
        <div class="treb-locked-title">Locked (not selectable)</div>
        <div id="lockedListT" class="treb-locked-chips"></div>
      </div>
    `;

    body.appendChild(left); body.appendChild(center); body.appendChild(right);

    // Footer help
    const help = document.createElement('div');
    help.className = 'treb-help';
    help.textContent = 'Keyboard: ←/→ shift freq | Q/W change Q-Value | ↑/↓ central gain | M = mark sweep issue | Enter = save filter';

    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.appendChild(help);

    document.body.appendChild(overlayBackdrop);
    document.body.appendChild(overlay);

    // Wire UI logic (a minimal, adapted port of treblePeakKiller)
    wireUI();
    redrawFiltersTable();

    // Apply responsive title for viewport size (mobile vs desktop)
    applyResponsiveTitle();
    window.addEventListener('resize', applyResponsiveTitle);
  }

  function closeOverlay() {
    try { stopSweep(); } catch (_) {}
    try { if (twoToneController) twoToneController.stop(); } catch (_) {}
    if (overlay) overlay.remove();
    if (overlayBackdrop) overlayBackdrop.remove();
    overlay = null; overlayBackdrop = null;
  }

  trebBtn.addEventListener('click', openOverlay);

  // ===================== Ported Logic (trimmed to essentials) =====================
  // DOM refs are suffixed with T
  let sweepOsc = null, sweepGain = null, sweepRAF = null;
  let sweepActive = false, sweepStartTime = 0, sweepDurationSec = 40;
  let currentSweepFreq = null; let sweepFilterNodes = [];
  const SWEEP_F_START = 4000, SWEEP_F_END = 16000;

  // Revisit and tones
  let toneActive = false;


  // Controller instances - initialized after audio context is ready
  let erbController = null;
  let sweepController = null;
  let twoToneController = null;

  // Track currently selected ERB band
  let selectedERBBand = 0;

  // Canvas
  let eqCanvas, eqCtx;

  // UI elements
  let sweepSpeed, sweepSpeedLabel, sweepStartBtn, sweepStopBtn, sweepMarkBtn, sweepFreqLabel, sweepApplyFilters, markTable;
  let toneCenter, toneCenterLabel, toneQ, toneQLabel, toneStep, toneStepLabel, toneStepHzLabel, toneGain, toneGainLabel;
  let toneStartBtn, toneStopBtn, modeToneNarrowBand, modeToneWarble, mode3TonePEQ, modeMicroSweep, modeERBBands, microSweepControls, microSweepDuration, microSweepDurationLabel;
  let advancedToneControls, erbBandControls, standardSliders;
  let erbBandSliders = []; // Will store slider elements for each ERB band
  let toneHUD, filterListElem, lockedWrapElem, lockedListElem, saveFilterBtn, peqTable;
  // Advanced mode
  let advancedModeElem, advancedMode = false;
  let advancedSweepControls, advancedSweepSpeedWrap;

  let sweepMarks = [];
  let sweepApplyWrap;

  // Expose certain UI re-render functions to outer scope so they can be called
  // from handlers defined outside of wireUI (e.g., saveTrebleFilterToSelected)
  let renderFilterListFn = null;

  // Responsive title text
  const TREB_LONG_TITLE = 'Treblizer PEQ: Find and Fix Your Personal Treble Resonances';
  const TREB_SHORT_TITLE = 'Treblizer PEQ';
  function applyResponsiveTitle(){
    try {
      const isNarrow = window.innerWidth <= 820;
      const el = document.getElementById('trebOverlayTitle');
      if (el) el.textContent = isNarrow ? TREB_SHORT_TITLE : TREB_LONG_TITLE;
    } catch (_) {}
  }

  function wireUI() {
    sweepSpeed = document.getElementById('sweepSpeedT');
    sweepSpeedLabel = document.getElementById('sweepSpeedLabelT');
    sweepStartBtn = document.getElementById('sweepStartBtnT');
    sweepStopBtn = document.getElementById('sweepStopBtnT');
    sweepMarkBtn = document.getElementById('sweepMarkBtnT');
    sweepFreqLabel = document.getElementById('sweepFreqLabelT');
    sweepApplyFilters = document.getElementById('sweepApplyFiltersT');
    sweepApplyWrap = document.getElementById('sweepApplyWrapT');
    markTable = document.getElementById('markTableT');

    eqCanvas = document.getElementById('eqCanvasT');
    eqCtx = eqCanvas.getContext('2d');
    // Defer initial resize/draw until after control refs are assigned
    window.addEventListener('resize', resizeEQCanvas);

    toneCenter = document.getElementById('toneCenterTT');
    toneCenterLabel = document.getElementById('toneCenterLabelT');
    toneQ = document.getElementById('toneQTT');
    toneQLabel = document.getElementById('toneQLabelT');
    toneStep = document.getElementById('toneStepTT');
    toneStepLabel = document.getElementById('toneStepLabelT');
    toneStepHzLabel = document.getElementById('toneStepHzLabelT');
    toneGain = document.getElementById('toneGainTT');
    toneGainLabel = document.getElementById('toneGainLabelT');
    toneStartBtn = document.getElementById('toneStartBtnT');
    toneStopBtn = document.getElementById('toneStopBtnT');
    modeERBBands = document.getElementById('modeERBBandsT');
    modeToneNarrowBand = document.getElementById('modeToneNarrowBandT');
    modeToneWarble = document.getElementById('modeToneWarbleT');
    mode3TonePEQ = document.getElementById('mode3TonePEQT');
    modeMicroSweep = document.getElementById('modeMicroSweepT');
    microSweepControls = document.getElementById('microSweepControlsT');
    microSweepDuration = document.getElementById('microSweepDurationT');
    microSweepDurationLabel = document.getElementById('microSweepDurationLabelT');
    advancedToneControls = document.getElementById('advancedToneControlsT');
    erbBandControls = document.getElementById('erbBandControlsT');
    standardSliders = document.getElementById('standardSlidersT');

    // Get ERB band slider references
    for (let i = 0; i < 4; i++) {
      erbBandSliders[i] = {
        slider: document.getElementById(`erbBand${i}T`),
        label: document.getElementById(`erbBand${i}LabelT`)
      };
    }
    toneHUD = document.getElementById('toneHUDT');
    filterListElem = document.getElementById('filterListT');
    lockedWrapElem = document.getElementById('lockedWrapT');
    lockedListElem = document.getElementById('lockedListT');
    saveFilterBtn = document.getElementById('saveFilterBtnT');
    peqTable = document.getElementById('peqTableT');

    // Advanced mode refs
    advancedModeElem = document.getElementById('advancedModeT');
    if (advancedModeElem) { advancedModeElem.disabled = false; advancedModeElem.style.pointerEvents = 'auto'; }
    // Ensure sweep apply checkbox is visible and enabled locally (always visible per requirement)
    if (sweepApplyFilters) {
      sweepApplyFilters.disabled = false;
      sweepApplyFilters.style.pointerEvents = 'auto';
      sweepApplyFilters.style.opacity = '1';
      sweepApplyFilters.style.visibility = 'visible';
    }
    if (sweepApplyWrap) { sweepApplyWrap.style.display = 'block'; }
    // Ensure revisit mode radios are enabled and interactive even if globally disabled
    [modeERBBands, modeToneNarrowBand, modeToneWarble, mode3TonePEQ, modeMicroSweep].forEach(elem => {
      if (elem) {
        elem.disabled = false;
        elem.style.pointerEvents = 'auto';
        elem.style.opacity = '1';
      }
    });
    advancedSweepControls = document.getElementById('advancedSweepControlsT');
    advancedSweepSpeedWrap = document.getElementById('advancedSweepSpeedWrapT');

    // Initialize sweep range controls
    const sweepStartInput = document.getElementById('sweepStartT');
    const sweepEndInput = document.getElementById('sweepEndT');
    const sweepRangeLabel = document.getElementById('sweepRangeLabelT');
    const sweepRangeSaveBtn = document.getElementById('sweepRangeSaveT');
    const updateSweepRangeUI = () => {
      sweepStartInput.value = String(sweepFStart);
      sweepEndInput.value = String(sweepFEnd);
      sweepRangeLabel.textContent = `${Math.round(sweepFStart)} Hz → ${Math.round(sweepFEnd)} Hz`;
      // Update tone slider min/max to match range
      toneCenter.min = String(sweepFStart);
      toneCenter.max = String(sweepFEnd);
      // Clamp current center into range
      const cur = Math.max(sweepFStart, Math.min(sweepFEnd, Number(toneCenter.value||((sweepFStart+sweepFEnd)/2))));
      toneCenter.value = String(Math.round(cur));
      toneCenterLabel.textContent = toneCenter.value;
      // Recompute +- range (Hz) label because it's % of band
      updateStepLabels();
      renderFilterList();
      resizeEQCanvas();
      drawEQGraph();
    };
    updateSweepRangeUI();
    const applySweepRangeInputs = () => {
      let s = Number(sweepStartInput.value), e = Number(sweepEndInput.value);
      if (!isFinite(s) || !isFinite(e)) return updateSweepRangeUI();
      // basic guards
      s = Math.max(1000, Math.min(20000, Math.round(s)));
      e = Math.max(2000, Math.min(24000, Math.round(e)));
      if (e <= s+500) e = s + 500; // ensure some span
      sweepFStart = s; sweepFEnd = e;
      // Update controller configurations
      if (sweepController) {
        sweepController.config.sweepFStart = s;
        sweepController.config.sweepFEnd = e;
      }
      if (twoToneController) {
        twoToneController.config.sweepFStart = s;
        twoToneController.config.sweepFEnd = e;
      }
      updateSweepRangeUI();
    };
    sweepStartInput.addEventListener('change', applySweepRangeInputs);
    sweepEndInput.addEventListener('change', applySweepRangeInputs);
    sweepRangeSaveBtn.addEventListener('click', () => { setCookie('treblizerSweepRange', `${sweepFStart},${sweepFEnd}`); updateSweepRangeUI(); });

    function isFilterLocked(f){
      // Rules:
      // - Lock if NOT a Peaking filter type
      // - Lock if frequency is out of range AND gain is non-zero (active out-of-range)
      const type = (f.type||'PK').toUpperCase();
      const notPK = !(type==='PK' || type==='PEAK' || type==='PEAKING');
      const outOfRange = !(f.fc >= sweepFStart && f.fc <= sweepFEnd);
      const gain = Number(f.gain || f.G || 0);
      const activeOutOfRange = outOfRange && Math.abs(gain) > 0.001;
      const locked = notPK || activeOutOfRange;
      let reason = '';
      if (notPK) reason = 'Not PK';
      else if (activeOutOfRange) reason = 'Locked (out of range & gain≠0)';
      return { locked, reason, outOfRange, gainZero: outOfRange && !activeOutOfRange };
    }

    // Update Save to Filter button state based on selection
    function updateSaveButtonState() {
      if (saveFilterBtn) {
        const hasSelection = selectedFilterIndex >= 0;
        saveFilterBtn.disabled = !hasSelection;
        if (!hasSelection) {
          saveFilterBtn.title = 'Select a filter first';
        } else {
          saveFilterBtn.title = 'Save current adjustments to selected filter';
        }
      }
    }

    function renderFilterList(){
      if (!filterListElem) return;
      // Partition filters by locking rule
      const lockedIdx = [];
      const selectableIdx = [];
      for (let i=0;i<peqFilters.length;i++){
        if (isFilterLocked(peqFilters[i]).locked) lockedIdx.push(i); else selectableIdx.push(i);
      }

      // Render locked chips
      if (lockedListElem && lockedWrapElem){
        lockedListElem.innerHTML = '';
        if (lockedIdx.length && advancedMode){
          lockedWrapElem.style.display = 'block';
          lockedIdx.forEach((i)=>{
            const f = peqFilters[i];
            const info = isFilterLocked(f);
            const chip = document.createElement('span');
            chip.className = 'treb-chip';
            const freq = Math.round(f.fc);
            const type = (f.type||'PK');
            chip.textContent = `#${i+1} ${type} @ ${freq} Hz — ${info.reason || 'Locked'}`;
            lockedListElem.appendChild(chip);
          });
        } else {
          lockedWrapElem.style.display = 'none';
        }
      }

      // Render selectable list
      filterListElem.innerHTML = '';
      let didScroll=false;
      selectableIdx.forEach((i)=>{
        const f = peqFilters[i];
        const {locked, reason, outOfRange, gainZero} = isFilterLocked(f);
        const item = document.createElement('div');
        item.className = 'treb-filter-row';
        const isSel = (i===selectedFilterIndex);
        if (isSel) item.classList.add('selected');
        const left = document.createElement('div');
        left.textContent = `${i+1}: ${(f.type||'PK')} @ ${Math.round(f.fc)} Hz, ${Math.round(f.gain*10)/10} dB, Q=${Math.round(f.q*100)/100}`;
        const badge = document.createElement('span');
        badge.className = 'badge';
        if (outOfRange && gainZero) {
          badge.textContent = 'Out of range (gain 0)';
        } else {
          badge.textContent = isSel? 'Selected':'';
        }
        const revisitBtn = document.createElement('button');
        revisitBtn.className = 'treb-btn secondary';
        revisitBtn.textContent = 'Revisit';
        revisitBtn.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          selectedFilterIndex = i; renderFilterList();
          const fc = Math.max(sweepFStart, Math.min(sweepFEnd, Math.round(f.fc||((sweepFStart+sweepFEnd)/2))));
          toneCenter.value = String(fc); toneCenterLabel.textContent = String(fc);
          const q = Math.max(0, Math.min(10, Number(f.q || 4))); toneQ.value = String(q); toneQLabel.textContent = q.toFixed(2);
          const g = Math.round((Number(f.gain || 0)) * 2) / 2; toneGain.value = String(g); toneGainLabel.textContent = String(g);
          updateStepLabels(); drawEQGraph();
        });
        item.appendChild(left); item.appendChild(badge); item.appendChild(revisitBtn);
        item.addEventListener('click', ()=>{
          selectedFilterIndex = i; renderFilterList();
          // Prefill revisit controls from selected
          const fc = Math.max(sweepFStart, Math.min(sweepFEnd, Math.round(f.fc||((sweepFStart+sweepFEnd)/2))));
          toneCenter.value = String(fc); toneCenterLabel.textContent = String(fc);
          const q = Math.max(0, Math.min(10, Number(f.q || 4))); toneQ.value = String(q); toneQLabel.textContent = q.toFixed(2);
          const g = Math.round((Number(f.gain || 0)) * 2) / 2; toneGain.value = String(g); toneGainLabel.textContent = String(g);
          updateStepLabels(); drawEQGraph();
        });
        filterListElem.appendChild(item);
        if (isSel && !didScroll) { try { item.scrollIntoView({block:'nearest'}); didScroll=true; } catch(_) {} }
      });

      // Ensure selection is valid
      if (selectedFilterIndex < 0 || isFilterLocked(peqFilters[selectedFilterIndex]||{}).locked){
        selectedFilterIndex = selectableIdx.length ? selectableIdx[0] : -1;
      }

      // Update save button state based on selection
      updateSaveButtonState();
    }
    // initial render
    renderFilterList();
    // expose to outer scope for external callers
    renderFilterListFn = renderFilterList;

    // Check if no filters are available and warn user
    if (selectedFilterIndex === -1 && peqFilters.length > 0) {
      setTimeout(() => {
        alert('⚠️ No Available PEQ Filters\n\nAll your PEQ filters are currently in use (locked).\n\nTo use Treblizer:\n1. Clear or disable some existing PEQ filters\n2. Make sure at least one filter is:\n   - Type: Peaking/Bell\n   - Frequency: 4-16 kHz range\n   - Gain: non-zero\n\nThen reopen Treblizer.');
      }, 100);
    }

    // Initialize sweep speed from cookie if available
    try {
      const spdCookie = getCookie('treblizerSweepSpeedSec');
      const spdNum = spdCookie ? Number(spdCookie) : NaN;
      if (isFinite(spdNum)) {
        const clamped = Math.max(2, Math.min(60, Math.round(spdNum)));
        sweepSpeed.value = String(clamped);
        sweepDurationSec = clamped;
      }
    } catch (_) {}
    sweepSpeedLabel.textContent = sweepSpeed.value;

    // Default labels
    updateStepLabels();
    // Advanced mode init/persist
    try {
      const advCookie = getCookie('treblizerAdvancedMode');
      advancedMode = advCookie ? advCookie === '1' : false;
    } catch (_) { advancedMode = false; }
    if (advancedModeElem) advancedModeElem.checked = !!advancedMode;

    const applyAdvancedModeUI = () => {
      if (advancedSweepControls) advancedSweepControls.style.display = advancedMode ? 'flex' : 'none';
      if (advancedSweepSpeedWrap) advancedSweepSpeedWrap.style.display = advancedMode ? 'block' : 'none';
      // Update revisit mode UI to show/hide advanced controls
      updateRevisitModeUI();
      // Locked chips visibility handled inside renderFilterList using advancedMode flag
      renderFilterList();
      drawEQGraph();
    };

    if (advancedModeElem) {
      advancedModeElem.addEventListener('change', () => {
        advancedMode = !!advancedModeElem.checked;
        setCookie('treblizerAdvancedMode', advancedMode ? '1' : '0');
        applyAdvancedModeUI();
        updateRevisitModeUI();
      });
    }

    updateRevisitModeUI();
    applyAdvancedModeUI();

    // Now that all control refs are valid, perform initial canvas sizing and draw
    resizeEQCanvas();

    // Sweep handlers
    sweepSpeed.addEventListener('input', () => { sweepSpeedLabel.textContent = sweepSpeed.value; sweepDurationSec = Number(sweepSpeed.value); setCookie('treblizerSweepSpeedSec', String(sweepDurationSec)); });
    document.addEventListener('keydown', (e) => { if (sweepActive && e.key.toLowerCase()==='m' && currentSweepFreq) { addSweepMark(currentSweepFreq); } });
    document.getElementById('sweepStartBtnT').addEventListener('click', startSweep);
    document.getElementById('sweepStopBtnT').addEventListener('click', stopSweep);
    document.getElementById('sweepMarkBtnT').addEventListener('click', () => { if (sweepActive && currentSweepFreq) addSweepMark(currentSweepFreq); });
    if (sweepApplyFilters) sweepApplyFilters.addEventListener('change', () => { if (sweepActive) { disconnectSweepChain(); buildSweepChain(); } });

    // Revisit handlers
    modeERBBands.addEventListener('change', updateRevisitModeUI);
    modeToneNarrowBand.addEventListener('change', updateRevisitModeUI);
    modeToneWarble.addEventListener('change', updateRevisitModeUI);
    mode3TonePEQ.addEventListener('change', updateRevisitModeUI);
    modeMicroSweep.addEventListener('change', updateRevisitModeUI);
    microSweepDuration.addEventListener('input', () => microSweepDurationLabel.textContent = microSweepDuration.value);
    document.getElementById('refFreqT').addEventListener('input', () => document.getElementById('refFreqLabelT').textContent = document.getElementById('refFreqT').value);
    document.getElementById('noiseBWT').addEventListener('input', () => document.getElementById('noiseBWLabelT').textContent = Number(document.getElementById('noiseBWT').value).toFixed(2));

    // ERB band card click handlers
    for (let i = 0; i < 4; i++) {
      const card = document.getElementById(`erbBandCard${i}T`);

      if (card) {
        card.addEventListener('click', (e) => {
          // Don't trigger if clicking the slider
          if (e.target.type !== 'range') {
            updateERBBandSelection(i);
          }
        });
      }
    }

    // ERB band slider handlers
    for (let i = 0; i < 4; i++) {
      erbBandSliders[i].slider.addEventListener('input', () => {
        const val = Number(erbBandSliders[i].slider.value);
        erbBandSliders[i].label.textContent = val.toFixed(1);

        ensureControllers();

        // Update controller levels
        if (erbController) {
          const levels = erbController.getLevels();
          levels[i] = val;
          erbController.setLevels(levels);

          // Auto-start playback if not already playing
          if (!erbController.isActive() && modeERBBands && modeERBBands.checked) {
            erbController.start();
          }
        }
        // Also select this band when slider is moved
        updateERBBandSelection(i);
      });
    }

    // Initialize the first band as selected
    updateERBBandSelection(0);

    // ERB reference selector (advanced mode)
    const erbReferenceSelect = document.getElementById('erbReferenceSelectT');
    if (erbReferenceSelect) {
      erbReferenceSelect.addEventListener('change', () => {
        const refIndex = parseInt(erbReferenceSelect.value);
        if (erbController) {
          erbController.setReferenceBand(refIndex);
        }
      });
    }

    toneCenter.addEventListener('input', () => { toneCenterLabel.textContent = toneCenter.value; updateStepLabels(); drawEQGraph(); });
    toneQ.addEventListener('input', () => { const qVal = Math.max(0, Math.min(10, Number(toneQ.value))); toneQ.value = String(qVal); toneQLabel.textContent = qVal.toFixed(2); drawEQGraph(); });
    toneStep.addEventListener('input', () => { updateStepLabels(); drawEQGraph(); });
    toneGain.addEventListener('input', () => { toneGainLabel.textContent = toneGain.value; drawEQGraph(); });
    toneStartBtn.addEventListener('click', () => {
      ensureControllers();

      // Check if anything is currently playing
      const isPlaying = (erbController && erbController.isActive()) ||
                        (sweepController && sweepController.isActive()) ||
                        (twoToneController && twoToneController.isActive());

      if (isPlaying) {
        // Stop all playback
        if (erbController) erbController.stop();
        if (sweepController) sweepController.stopAll();
        if (twoToneController) twoToneController.stop();
      } else {
        // Start playback
        // Stop sweep analyzer if running to avoid confusion
        if (sweepActive) stopSweep();

        if (modeERBBands.checked) {
          // Sync slider values to controller before starting
          const levels = [
            Number(document.getElementById('erbBand0T').value),
            Number(document.getElementById('erbBand1T').value),
            Number(document.getElementById('erbBand2T').value),
            Number(document.getElementById('erbBand3T').value)
          ];
          erbController.setLevels(levels);
          erbController.start();
        } else if (document.getElementById('modePEQSweepT')?.checked || !modeERBBands.checked) {
          // PEQ Sweep modes - check which sub-mode is selected
          if (modeMicroSweep.checked) {
            sweepController.startMicroSweep();
          } else if (modeToneNarrowBand.checked) {
            twoToneController.start('noise');
          } else if (modeToneWarble.checked) {
            twoToneController.start('warble');
          } else {
            sweepController.start3Tone();
          }
        }
      }
    });

    // Save current settings back to selected filter
    saveFilterBtn.addEventListener('click', saveTrebleFilterToSelected);

    // Info button handlers
    const erbInfoBtn = document.getElementById('erbInfoBtnT');
    const sweepInfoBtn = document.getElementById('sweepInfoBtnT');

    // Simple markdown to HTML converter
    function markdownToHTML(text) {
      // First, handle bold text: **text** -> <strong>text</strong>
      let html = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

      // Split into lines for better processing
      const lines = html.split('\n');
      const processed = [];
      let inList = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('•')) {
          // Bullet point
          if (!inList) {
            processed.push('<ul style="margin:8px 0; padding-left:20px;">');
            inList = true;
          }
          processed.push('<li>' + line.substring(1).trim() + '</li>');
        } else if (line.startsWith('→')) {
          // Arrow point (special formatting)
          if (inList) {
            processed.push('</ul>');
            inList = false;
          }
          processed.push('<div style="margin:8px 0; padding-left:10px;">' + line + '</div>');
        } else if (line === '') {
          // Empty line
          if (inList) {
            processed.push('</ul>');
            inList = false;
          }
          processed.push('<br>');
        } else {
          // Regular line
          if (inList) {
            processed.push('</ul>');
            inList = false;
          }
          processed.push('<div style="margin:4px 0;">' + line + '</div>');
        }
      }

      // Close any open list
      if (inList) {
        processed.push('</ul>');
      }

      return processed.join('\n');
    }

    function showInfoModal(info) {
      // Create backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'treb-info-modal-backdrop';

      // Convert markdown to HTML
      const detailsHTML = markdownToHTML(info.details);

      // Create modal
      const modal = document.createElement('div');
      modal.className = 'treb-info-modal';
      modal.innerHTML = `
        <span class="treb-info-modal-close">&times;</span>
        <h3>${info.title}</h3>
        <p style="font-weight:600;">${info.summary}</p>
        <div style="margin-top:12px; line-height:1.6;">${detailsHTML}</div>
      `;

      // Close handlers
      const close = () => {
        backdrop.remove();
        modal.remove();
      };
      modal.querySelector('.treb-info-modal-close').addEventListener('click', close);
      backdrop.addEventListener('click', close);

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
    }

    if (erbInfoBtn) {
      erbInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showInfoModal(ERB_INFO);
      });
    }

    if (sweepInfoBtn) {
      sweepInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Show context-specific info based on selected sub-mode
        let infoToShow = SWEEP_INFO; // Default

        if (mode3TonePEQ && mode3TonePEQ.checked) {
          infoToShow = TONE_3_INFO;
        } else if (modeMicroSweep && modeMicroSweep.checked) {
          infoToShow = TONE_MICROSWEEP_INFO;
        } else if (modeToneNarrowBand && modeToneNarrowBand.checked) {
          infoToShow = TONE_NARROWBAND_INFO;
        } else if (modeToneWarble && modeToneWarble.checked) {
          infoToShow = TONE_WARBLE_INFO;
        }

        showInfoModal(infoToShow);
      });
    }

    // Make the tuning info button context-aware - always show modal popup
    const erbTuningInfoBtn = document.getElementById('erbTuningInfoBtnT');
    if (erbTuningInfoBtn) {
      erbTuningInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Check if we're in ERB mode or PEQ Sweep mode
        const isERBMode = modeERBBands && modeERBBands.checked;

        let infoToShow;

        if (isERBMode) {
          // Show ERB tuning info modal
          infoToShow = ERB_TUNING_INFO;
        } else {
          // Show context-specific PEQ Sweep info modal
          if (mode3TonePEQ && mode3TonePEQ.checked) {
            infoToShow = TONE_3_INFO;
          } else if (modeMicroSweep && modeMicroSweep.checked) {
            infoToShow = TONE_MICROSWEEP_INFO;
          } else if (modeToneNarrowBand && modeToneNarrowBand.checked) {
            infoToShow = TONE_NARROWBAND_INFO;
          } else if (modeToneWarble && modeToneWarble.checked) {
            infoToShow = TONE_WARBLE_INFO;
          } else {
            infoToShow = SWEEP_INFO; // Default
          }
        }

        showInfoModal(infoToShow);
      });
    }

    // PEQ Sweep method section radio handler
    const modePEQSweep = document.getElementById('modePEQSweepT');
    if (modePEQSweep) modePEQSweep.addEventListener('change', updateRevisitModeUI);

    // Apply header button
    document.getElementById('applyTreblizerPEQOverlay').addEventListener('click', () => {
      try {
        const out = peqFilters.map(f => ({ type: f.type || 'PK', freq: Math.floor(f.fc), gain: Math.round(f.gain*10)/10, q: Math.round(f.q*10)/10, disabled: !!f.disabled }));
        if (context && typeof context.filtersToElem === 'function') context.filtersToElem(out);
        if (context && typeof context.applyEQ === 'function') { try { context.applyEQ(); } catch(_) {} }
        try { document.dispatchEvent(new CustomEvent('UpdateExtensionFilters')); } catch(_){}
      } catch (e) { console.error('Treblizer Apply failed:', e); }
      closeOverlay();
    });

    // Keyboard nudging during revisit
    document.addEventListener('keydown', revisitKeyHandler);
  }

  function revisitKeyHandler(e) {
    if (!toneActive) return;
    const step = getStepHz();
    switch (e.key) {
      case 'ArrowLeft': toneCenter.value = String(Number(toneCenter.value) - step); toneCenterLabel.textContent = toneCenter.value; drawEQGraph(); break;
      case 'ArrowRight': toneCenter.value = String(Number(toneCenter.value) + step); toneCenterLabel.textContent = toneCenter.value; drawEQGraph(); break;
      case 'q': case 'Q': toneQ.value = String(Math.min(10, Number(toneQ.value) + 0.2)); toneQLabel.textContent = Number(toneQ.value).toFixed(2); drawEQGraph(); break;
      case 'w': case 'W': toneQ.value = String(Math.max(0, Number(toneQ.value) - 0.2)); toneQLabel.textContent = Number(toneQ.value).toFixed(2); drawEQGraph(); break;
      case 'ArrowDown': toneGain.value = String(Number(toneGain.value) - 0.5); toneGainLabel.textContent = toneGain.value; drawEQGraph(); break;
      case 'ArrowUp': toneGain.value = String(Number(toneGain.value) + 0.5); toneGainLabel.textContent = toneGain.value; drawEQGraph(); break;
      case 'Enter': saveTrebleFilterToSelected(); break;
    }
  }

  function updateRevisitModeUI() {
    const isERBBands = modeERBBands.checked;
    const isPEQSweep = document.getElementById('modePEQSweepT')?.checked;
    const isMicro = modeMicroSweep.checked;
    const isToneNarrowBand = modeToneNarrowBand.checked;
    const isToneWarble = modeToneWarble.checked;
    const is3TonePEQ = mode3TonePEQ.checked;

    // Show/hide method sections
    const peqControls = document.getElementById('peqSweepControlsT');

    if (isERBBands) {
      erbBandControls.style.display = 'block';
      if (peqControls) peqControls.style.display = 'none';
      if (standardSliders) standardSliders.style.display = 'none';
    } else if (isPEQSweep || !isERBBands) {
      erbBandControls.style.display = 'none';
      if (peqControls) peqControls.style.display = 'block';
      if (standardSliders) standardSliders.style.display = 'block';
    }

    // Show ERB advanced controls when in ERB mode AND advanced
    const erbAdvancedControls = document.getElementById('erbAdvancedControlsT');
    const showERBAdvanced = isERBBands && advancedMode;
    if (erbAdvancedControls) erbAdvancedControls.style.display = showERBAdvanced ? 'block' : 'none';

    // Show micro controls only when in micro mode AND advanced
    const showMicroControls = isMicro && advancedMode;
    if (microSweepControls) microSweepControls.style.display = showMicroControls ? 'block' : 'none';

    // Show advanced tone controls (ref frequency, noise BW) only when in tone mode (narrow-band or warble) AND advanced
    const showAdvancedToneControls = (isToneNarrowBand || isToneWarble) && advancedMode;
    if (advancedToneControls) advancedToneControls.style.display = showAdvancedToneControls ? 'block' : 'none';

    // Update button text
    let btnText = 'Start';
    if (isERBBands) btnText = 'Start ERB Volume Levelling';
    else if (isMicro) btnText = 'Start microSweep';
    else if (isToneNarrowBand) btnText = 'Start Narrow Band';
    else if (isToneWarble) btnText = 'Start Warble';
    else if (is3TonePEQ) btnText = 'Start 3‑Tone';
    toneStartBtn.textContent = btnText;
  }

  // Returns HALF of the span used for microSweep/3‑Tone bounds, based on percentage of the active sweep band (not of fc)
  function getStepHz() {
    const percent = Number(document.getElementById('toneStepTT').value);
    const band = Math.max(1, (sweepFEnd - sweepFStart));
    return (band * (percent / 100)) / 2; // half-span in Hz
  }

  // Calculate the lower/upper frequency bounds around center using the current percentage of the sweep band
  function getPercentBounds(fc) {
    const half = getStepHz();
    let fLo = fc - half;
    let fHi = fc + half;
    // clamp to sweep range
    if (fLo < sweepFStart) fLo = sweepFStart;
    if (fHi > sweepFEnd) fHi = sweepFEnd;
    return { fLo, fHi, half };
  }
  function updateStepLabels() {
    const pct = Number(document.getElementById('toneStepTT').value);
    document.getElementById('toneStepLabelT').textContent = pct.toFixed(2);
    const hzHalf = getStepHz();
    document.getElementById('toneStepHzLabelT').textContent = String(Math.round(hzHalf));
  }

  function resizeEQCanvas() {
    if (!eqCanvas) return; const r = eqCanvas.getBoundingClientRect();
    eqCanvas.width = Math.max(100, Math.floor(r.width));
    eqCanvas.height = Math.max(100, Math.floor(r.height));
    drawEQGraph();
  }
  function freqToX(f) { const f0=sweepFStart,f1=sweepFEnd; const ratio = Math.log(f/f0)/Math.log(f1/f0); return ratio * (eqCanvas?.width||1); }
  function xToFreq(x) { const f0=sweepFStart,f1=sweepFEnd; const ratio = x / (eqCanvas?.width||1); return f0 * Math.pow(f1/f0, ratio); }
  function dBToY(db) { const maxDB=12,minDB=-12; const frac=(db-maxDB)/(minDB-maxDB); return frac*(eqCanvas?.height||1); }

  function drawGrid() {
    const W=eqCanvas.width,H=eqCanvas.height; const ctx=eqCtx; ctx.clearRect(0,0,W,H); ctx.fillStyle='#0f1113'; ctx.fillRect(0,0,W,H);
    // horizontal 0 dB
    ctx.strokeStyle='#333'; ctx.lineWidth=1; ctx.beginPath(); const y0=dBToY(0); ctx.moveTo(0,y0); ctx.lineTo(W,y0); ctx.stroke();

    // vertical grid + frequency axis (log spaced)
    const ticks = genFreqTicks(sweepFStart, sweepFEnd);
    // minor grid lines
    ctx.strokeStyle = '#1a1d21';
    ticks.minor.forEach(f=>{ const x=freqToX(f); ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H-18); ctx.stroke(); });
    // major grid lines
    ctx.strokeStyle = '#222';
    ticks.major.forEach(f=>{ const x=freqToX(f); ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H-16); ctx.stroke(); });
    // labels
    ctx.fillStyle = '#9ea2a8';
    ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const labelY = H - 14;
    let lastLabelRight = -Infinity;
    ticks.labeled.forEach(f=>{
      let x = freqToX(f);
      const text = formatHzShort(f);
      const w = ctx.measureText(text).width;
      // clamp label center so it isn't clipped at edges
      x = Math.max(w/2 + 2, Math.min(W - w/2 - 2, x));
      // avoid overlap by simple culling
      if (x - w/2 <= lastLabelRight + 6) return;
      ctx.fillText(text, x, labelY);
      lastLabelRight = x + w/2;
    });
  }

  // Generate log-spaced frequency ticks between start and end
  function genFreqTicks(fStart, fEnd){
    const majorBases = [1,2,3,4,5,6,8];
    const minorBases = [1.5, 2.5, 3.5, 7];
    const major = [], minor = [];
    let labeled = [];
    const minPow = Math.floor(Math.log10(fStart));
    const maxPow = Math.ceil(Math.log10(fEnd));
    for (let p=minPow; p<=maxPow; p++){
      const decade = Math.pow(10,p);
      majorBases.forEach(b=>{
        const f = b*decade;
        if (f>=fStart && f<=fEnd) {
          major.push(f);
        }
      });
      minorBases.forEach(b=>{
        const f = b*decade;
        if (f>=fStart && f<=fEnd) minor.push(f);
      });
    }
    // Preferred labeled frequencies within the treble band to avoid edge clipping and add clarity
    const preferredK = [5,6,7,8,9,10,11,12,13,14,15];
    const preferred = preferredK.map(k=>k*1000).filter(f=>f>=fStart && f<=fEnd);
    // Fallback: if range doesn't include any preferred, use select majors (2,4,8 per decade)
    if (preferred.length){ labeled = preferred; }
    else {
      major.forEach(f=>{
        const k = f/Math.pow(10, Math.floor(Math.log10(f)));
        if (k===1 || k===2 || k===4 || k===8) labeled.push(f);
      });
    }
    // Deduplicate and sort
    const sortNum = (a,b)=>a-b; major.sort(sortNum); minor.sort(sortNum);
    labeled = Array.from(new Set(labeled.map(v=>Math.round(v)))).sort(sortNum);
    return { major, minor, labeled };
  }

  function formatHzShort(f){
    if (f >= 1000) {
      const k = f/1000;
      // integers like 4k, 8k, 12k; else 1.5k
      const rounded = Math.abs(k - Math.round(k)) < 1e-6 ? String(Math.round(k)) : (k%1===0? String(k): k.toFixed(k<10?1:0));
      return `${rounded}k`;
    }
    return String(Math.round(f));
  }

  function drawSavedFilterCurves() {
    if (!peqFilters || !peqFilters.length) return; const W=eqCanvas.width; const ctx=eqCtx;
    const palette = ['rgba(245,63,173,0.6)','rgba(63,169,245,0.6)','rgba(63,217,106,0.6)','rgba(245,184,63,0.6)','rgba(150,100,255,0.6)'];
    peqFilters.forEach((b, idx)=>{
      // Skip out-of-range filters for graph visuals
      if (!(b.fc >= sweepFStart && b.fc <= sweepFEnd)) return;
      const qVal = Math.max(0, Math.min(10, b.q)); ctx.strokeStyle = palette[idx%palette.length]; ctx.lineWidth=1.2; ctx.beginPath();
      for (let i=0;i<W;i++){ const frac=i/W; const f=sweepFStart*Math.pow(sweepFEnd/sweepFStart,frac); const y=dBToY(biquadMagQ(b.fc, b.gain, qVal, f)); if(i===0) ctx.moveTo(i,y); else ctx.lineTo(i,y); }
      ctx.stroke();
    });
  }

  function drawCurrentFilterOverlay() {
    // Guard against early calls before inputs are wired
    if (!toneCenter || !toneQ || !toneGain) return;

    // Only draw PEQ overlay when in PEQ Sweep mode
    const isPEQSweepMode = document.getElementById('modePEQSweepT')?.checked;
    if (!isPEQSweepMode) return;

    const fc=Number(toneCenter.value); const Qraw=Number(toneQ.value); const qVal=Math.max(0,Qraw); const g=Number(toneGain.value); const W=eqCanvas.width; const ctx=eqCtx;
    ctx.strokeStyle='rgba(63,169,245,0.9)'; ctx.lineWidth=1.7; ctx.beginPath();
    for(let i=0;i<W;i++){ const frac=i/W; const f=sweepFStart*Math.pow(sweepFEnd/sweepFStart,frac); const y=dBToY(biquadMagQ(fc,g,qVal,f)); if(i===0) ctx.moveTo(i,y); else ctx.lineTo(i,y); }
    ctx.stroke();
    const stepHz=getStepHz(); [fc-stepHz, fc, fc+stepHz].forEach((f,idx)=>{ if(f<sweepFStart||f>sweepFEnd) return; const x=freqToX(f); ctx.strokeStyle= idx===1? '#3fa9f5':'#888'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,10); ctx.stroke(); });
  }


  function draw2ToneRefDot() {
    if (!twoToneController) return;
    const currentRefFreq = twoToneController.getCurrentRefFreq();
    if (!currentRefFreq) return;
    const f = Math.max(sweepFStart, Math.min(sweepFEnd, currentRefFreq));
    const fc = Number(toneCenter.value);
    const Qraw = Number(toneQ.value);
    const qVal = Math.max(0, Qraw);
    const g = Number(toneGain.value);
    const x = freqToX(f);
    const y = dBToY(biquadMagQ(fc, g, qVal, f));
    const ctx = eqCtx;
    const rOuter = 5, rInner = 2.5;

    ctx.beginPath();
    ctx.arc(x, y, rOuter, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rOuter);
    grad.addColorStop(0, 'rgba(63,245,169,0.95)'); // Green tint for 2-tone ref
    grad.addColorStop(1, 'rgba(63,245,169,0.25)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rInner, 0, Math.PI * 2);
    ctx.fillStyle = '#c6ffe7';
    ctx.fill();
  }

  function draw3ToneDot() {
    if (!sweepController) return;
    const current3ToneFreq = sweepController.get3ToneFreq();
    if (!current3ToneFreq) return;
    const f = Math.max(sweepFStart, Math.min(sweepFEnd, current3ToneFreq));
    const fc = Number(toneCenter.value);
    const Qraw = Number(toneQ.value);
    const qVal = Math.max(0, Qraw);
    const g = Number(toneGain.value);
    const x = freqToX(f);
    const y = dBToY(biquadMagQ(fc, g, qVal, f));
    const ctx = eqCtx;
    const rOuter = 6, rInner = 3;

    ctx.beginPath();
    ctx.arc(x, y, rOuter, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rOuter);
    grad.addColorStop(0, 'rgba(63,169,245,0.95)'); // Blue tint for 3-tone
    grad.addColorStop(1, 'rgba(63,169,245,0.25)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, rInner, 0, Math.PI * 2);
    ctx.fillStyle = '#c6e6ff';
    ctx.fill();
  }

  function drawSweepMarks() {
    if (!sweepMarks.length) return; const y0=dBToY(0); const ctx=eqCtx; ctx.fillStyle='#f53fad'; sweepMarks.forEach(m=>{ const x=freqToX(m.freq); ctx.beginPath(); ctx.arc(x,y0,3,0,Math.PI*2); ctx.fill(); });
  }

  function drawERBPreview() {
    // Show preview of ERB band adjustment as a filter curve
    if (!erbController || !modeERBBands || !modeERBBands.checked) return;

    const levels = erbController.getLevels();
    const adjustedBands = erbController.getAdjustedBands();

    if (adjustedBands.length === 0) return;

    // Draw the selected band's filter curve
    const bandIdx = selectedERBBand;
    if (Math.abs(levels[bandIdx]) < 0.1) return; // No adjustment

    // Find the adjusted band data for the selected band
    const adjusted = adjustedBands.find(b => b.bandIndex === bandIdx);
    if (!adjusted) return;

    const { centerFreq, Q, gain } = adjusted;
    const W = eqCanvas.width;
    const ctx = eqCtx;

    // Draw the filter response curve
    ctx.strokeStyle = ERB_BANDS[bandIdx].color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]); // Dashed line for preview
    ctx.beginPath();

    for (let px = 0; px < W; px++) {
      const freq = xToFreq(px);
      const filterGain = biquadMagQ(centerFreq, gain, Q, freq);
      const y = dBToY(filterGain);
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset to solid line
  }

  function drawEQCurve() {
    // Draw a flat baseline at 0 dB to avoid confusion on initial load
    const W=eqCanvas.width; const ctx=eqCtx; const y0 = dBToY(0);
    ctx.strokeStyle = '#3fa9f5'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
  }

  function drawSweepDot(){
    if (!currentSweepFreq) return;
    const f = Math.max(sweepFStart, Math.min(sweepFEnd, currentSweepFreq));
    // If applying saved filters, make the dot follow the combined curve; else baseline 0 dB
    const apply = sweepApplyFilters && sweepApplyFilters.checked;
    const yDb = apply ? totalEQGainAtFreq(f) : 0;
    const x = freqToX(f); const y = dBToY(yDb);
    const ctx = eqCtx; const rOuter=5, rInner=2.5;
    ctx.beginPath(); ctx.arc(x,y,rOuter,0,Math.PI*2);
    const grad=ctx.createRadialGradient(x,y,0,x,y,rOuter);
    grad.addColorStop(0,'rgba(245,184,63,0.95)'); grad.addColorStop(1,'rgba(245,184,63,0.25)');
    ctx.fillStyle=grad; ctx.fill(); ctx.beginPath(); ctx.arc(x,y,rInner,0,Math.PI*2); ctx.fillStyle='#fff1c6'; ctx.fill();
  }

  function drawEQGraph() {
    if (!eqCanvas?.width) return; drawGrid(); drawSavedFilterCurves(); drawEQCurve();
    if (currentSweepFreq) { const x=freqToX(currentSweepFreq); eqCtx.strokeStyle='#f5b83f'; eqCtx.lineWidth=1.0; eqCtx.beginPath(); eqCtx.moveTo(x,0); eqCtx.lineTo(x,eqCanvas.height); eqCtx.stroke(); drawSweepDot(); }
    drawCurrentFilterOverlay(); draw2ToneRefDot(); draw3ToneDot(); drawSweepMarks(); drawERBPreview();

    // Draw ERB bands if active
    if (erbController && erbController.isActive()) {
      const currentBandIdx = erbController.getCurrentBandIndex();
      const referenceBandIdx = erbController.getReferenceBand();

      ERB_BANDS.forEach((band, idx) => {
        const levels = erbController.getLevels();
        const xStart = freqToX(band.fLow);
        const xEnd = freqToX(band.fHigh);

        // Show adjusted bands with subtle fill
        if (Math.abs(levels[idx]) > 0.1) {
          eqCtx.fillStyle = band.color + '33'; // 20% opacity
          eqCtx.fillRect(xStart, 0, xEnd - xStart, eqCanvas.height);
        }

        // Flash/highlight the currently playing band
        if (currentBandIdx === idx) {
          // Currently playing this band - bright flash
          eqCtx.fillStyle = band.color + 'AA'; // 67% opacity
          eqCtx.fillRect(xStart, 0, xEnd - xStart, eqCanvas.height);

          // Add a bright border
          eqCtx.strokeStyle = band.color;
          eqCtx.lineWidth = 3;
          eqCtx.strokeRect(xStart, 0, xEnd - xStart, eqCanvas.height);
        }
      });

      // Highlight reference band if playing reference
      if (currentBandIdx === -1) {
        if (referenceBandIdx >= 0 && referenceBandIdx <= 3) {
          // Reference is an ERB band
          const refBand = ERB_BANDS[referenceBandIdx];
          const xStart = freqToX(refBand.fLow);
          const xEnd = freqToX(refBand.fHigh);
          eqCtx.fillStyle = refBand.color + '88'; // 53% opacity
          eqCtx.fillRect(xStart, 0, xEnd - xStart, eqCanvas.height);

          eqCtx.strokeStyle = refBand.color;
          eqCtx.lineWidth = 2;
          eqCtx.strokeRect(xStart, 0, xEnd - xStart, eqCanvas.height);
        } else {
          // Reference is 900 Hz - draw a vertical line
          const x900 = freqToX(900);
          eqCtx.strokeStyle = '#FFD700'; // Gold color for reference
          eqCtx.lineWidth = 3;
          eqCtx.beginPath();
          eqCtx.moveTo(x900, 0);
          eqCtx.lineTo(x900, eqCanvas.height);
          eqCtx.stroke();
        }
      }
    }

    // Draw microsweep indicator if active
    if (sweepController && sweepController.isActive()) {
      const freq = sweepController.getMicroSweepFreq();
      if (freq) {
        const fc = Number(toneCenter.value);
        const Qraw = Number(toneQ.value);
        const qVal = Math.max(0, Qraw);
        const g = Number(toneGain.value);
        const f = Math.max(sweepFStart, Math.min(sweepFEnd, freq));
        const x = freqToX(f);
        const y = dBToY(biquadMagQ(fc, g, qVal, f));
        const isHolding = sweepController.isMicroSweepHolding();
        eqCtx.fillStyle = isHolding ? '#ff6b6b' : '#4ECDC4';
        eqCtx.beginPath();
        eqCtx.arc(x, y, 6, 0, 2 * Math.PI);
        eqCtx.fill();
      }
    }
  }

  function sweepFrequencyAtTime(t,totalTime){ const ratio=sweepFEnd/sweepFStart; const frac=t/totalTime; return sweepFStart*Math.pow(ratio, frac); }

  function buildSweepChain(){ if(!sweepOsc||!sweepGain) return; ensureAudio(); const apply = sweepApplyFilters && sweepApplyFilters.checked; if(!apply || !peqFilters.length){ sweepOsc.connect(sweepGain).connect(outPreGain); return; }
    let last=sweepGain; sweepFilterNodes.forEach(n=>{ try{n.disconnect();}catch(_){}}); sweepFilterNodes=[]; peqFilters.forEach(b=>{ const biq=audioCtx.createBiquadFilter(); biq.type='peaking'; biq.frequency.value=b.fc; biq.gain.value=b.gain; biq.Q.value=Math.max(b.q,0.0001); last.connect(biq); last=biq; sweepFilterNodes.push(biq); }); sweepOsc.connect(sweepGain); last.connect(outPreGain); }
  function disconnectSweepChain(){ try{ if(sweepOsc) sweepOsc.disconnect(); if(sweepGain) sweepGain.disconnect(); sweepFilterNodes.forEach(n=>{ try{n.disconnect();}catch(_){}});}catch(_){ } sweepFilterNodes=[]; }

  function startSweep(){ ensureAudio(); stopSweep(); sweepOsc=audioCtx.createOscillator(); sweepGain=audioCtx.createGain(); sweepGain.gain.value=0.15; sweepOsc.type='sine'; disconnectSweepChain(); buildSweepChain(); sweepStartTime=audioCtx.currentTime; sweepDurationSec=Number(sweepSpeed.value); sweepActive=true; sweepOsc.start(); sweepRAF=requestAnimationFrame(updateSweep); sweepStartBtn.disabled=true; sweepStopBtn.disabled=false; }
  function updateSweep(){ if(!sweepActive) return; const now=audioCtx.currentTime; const t=now-sweepStartTime; if (t>=sweepDurationSec){ sweepStartTime=now; }
    const f=sweepFrequencyAtTime(now - sweepStartTime, sweepDurationSec); currentSweepFreq=f; sweepOsc.frequency.setValueAtTime(f, now); sweepFreqLabel.textContent = Math.round(f);
    drawEQGraph(); sweepRAF=requestAnimationFrame(updateSweep); }
  function stopSweep(){ sweepActive=false; if(sweepOsc){ try{sweepOsc.stop();}catch(_){ } sweepOsc=null;} if(sweepRAF) cancelAnimationFrame(sweepRAF); sweepFreqLabel.textContent='—'; currentSweepFreq=null; sweepStartBtn.disabled=false; sweepStopBtn.disabled=true; }
  function addSweepMark(freq){ const f = Math.max(sweepFStart, Math.min(sweepFEnd, freq)); sweepMarks.push({freq:Math.round(f)}); renderMarkTable(); }
  function renderMarkTable(){ markTable.innerHTML=''; sweepMarks.forEach((m,i)=>{ const tr=document.createElement('tr'); tr.innerHTML = `<td>${m.freq}</td><td><button class="treb-btn success" data-f="${m.freq}">Revisit</button> <button class="treb-btn danger" data-i="${i}">Remove</button></td>`; markTable.appendChild(tr); });
    markTable.querySelectorAll('button.treb-btn.success').forEach(btn=>btn.addEventListener('click',(e)=>{
      const f = Number(e.target.getAttribute('data-f'));

      // Check which mode is currently active
      const isERBMode = modeERBBands && modeERBBands.checked;

      if (isERBMode) {
        // ERB mode: Find and select the best ERB band for this frequency
        const bandIdx = findBestERBBand(f);
        updateERBBandSelection(bandIdx);
      } else {
        // PEQ Sweep mode: Update the center frequency to the marked frequency
        toneCenter.value = String(Math.round(f));
        toneCenterLabel.textContent = toneCenter.value;

        // Update the graph to show the new center frequency
        drawEQGraph();

        // If sweep controller exists, update its config
        ensureControllers();
        if (sweepController) {
          sweepController.config.toneCenter = Math.round(f);
        }
      }
    }));
    markTable.querySelectorAll('button.treb-btn.danger').forEach(btn=>btn.addEventListener('click',(e)=>{ const i=Number(e.target.getAttribute('data-i')); sweepMarks.splice(i,1); renderMarkTable(); }));
    drawEQGraph(); }

  // HUD display functions (used by controllers)
  function showToneHUD(label, f){ const hud=document.getElementById('toneHUDT'); if (!hud) return; if (f){ hud.textContent = `Tone ${label} — ${Math.round(f)} Hz`; hud.style.opacity='1'; } else { hud.textContent='—'; hud.style.opacity='0.6'; } }
  function hideToneHUD(){ const hud=document.getElementById('toneHUDT'); if (hud) hud.style.opacity='0'; }

  /**
   * Find the best ERB band for a given frequency
   * @param {number} freq - Frequency in Hz
   * @returns {number} Band index (0-3)
   */
  function findBestERBBand(freq) {
    // Find all bands that contain this frequency
    const containingBands = ERB_BANDS.map((band, idx) => {
      if (freq >= band.fLow && freq <= band.fHigh) {
        const center = Math.sqrt(band.fLow * band.fHigh);
        const distance = Math.abs(freq - center);
        return { idx, distance };
      }
      return null;
    }).filter(b => b !== null);

    // If we found bands that contain the frequency, pick the closest to center
    if (containingBands.length > 0) {
      containingBands.sort((a, b) => a.distance - b.distance);
      return containingBands[0].idx;
    }

    // If no bands contain it, find the nearest band
    let nearestIdx = 0;
    let minDistance = Infinity;
    ERB_BANDS.forEach((band, idx) => {
      const center = Math.sqrt(band.fLow * band.fHigh);
      const distance = Math.abs(freq - center);
      if (distance < minDistance) {
        minDistance = distance;
        nearestIdx = idx;
      }
    });
    return nearestIdx;
  }

  /**
   * Update ERB band card highlighting and selection
   * @param {number} selectedIndex - Band index (0-3) to select
   */
  function updateERBBandSelection(selectedIndex) {
    selectedERBBand = selectedIndex;
    const colors = [
      'rgba(255,107,107,0.3)',
      'rgba(255,165,0,0.3)',
      'rgba(78,205,196,0.3)',
      'rgba(149,225,211,0.3)'
    ];

    for (let i = 0; i < 4; i++) {
      const card = document.getElementById(`erbBandCard${i}T`);
      if (card) {
        if (i === selectedIndex) {
          card.style.border = `2px solid ${colors[i]}`;
          card.style.boxShadow = `0 0 8px ${colors[i]}`;
        } else {
          card.style.border = '2px solid transparent';
          card.style.boxShadow = 'none';
        }
      }
    }

    // Update controller
    if (erbController) {
      erbController.setSelectedBand(selectedIndex);
    }
  }

  /**
   * Initialize audio controllers (ERB, Sweep, TwoTone)
   * Called lazily when needed
   */
  function ensureControllers() {
    if (!audioCtx) ensureAudio();

    if (!erbController) {
      erbController = new ERBTuningController(audioCtx, outPreGain, {
        showHUD: showToneHUD,
        hideHUD: hideToneHUD,
        drawGraph: drawEQGraph,
        updateButtons: (isActive) => {
          if (modeERBBands && modeERBBands.checked) {
            toneStartBtn.textContent = isActive ? 'Stop' : 'Start ERB Volume Levelling';
            toneStartBtn.className = isActive ? 'treb-btn secondary' : 'treb-btn';
          }
        }
      });
    }

    if (!sweepController) {
      sweepController = new SweepFineTuningController(audioCtx, outPreGain, {
        biquadMagQ,
        sweepFStart,
        sweepFEnd,
        toneCenter,
        toneQ,
        toneGain,
        getPercentBounds,
        microSweepDuration,
        showHUD: showToneHUD,
        hideHUD: hideToneHUD,
        drawGraph: drawEQGraph,
        updateButtons: (isActive) => {
          if (!modeERBBands || !modeERBBands.checked) {
            if (isActive) {
              toneStartBtn.textContent = 'Stop';
              toneStartBtn.className = 'treb-btn secondary';
            } else {
              // Determine correct start text based on mode
              const isMicro = modeMicroSweep && modeMicroSweep.checked;
              const isToneNarrowBand = modeToneNarrowBand && modeToneNarrowBand.checked;
              const isToneWarble = modeToneWarble && modeToneWarble.checked;
              const is3TonePEQ = mode3TonePEQ && mode3TonePEQ.checked;

              let startText = 'Start';
              if (isMicro) startText = 'Start microSweep';
              else if (isToneNarrowBand) startText = 'Start Narrow Band';
              else if (isToneWarble) startText = 'Start Warble';
              else if (is3TonePEQ) startText = 'Start 3‑Tone';

              toneStartBtn.textContent = startText;
              toneStartBtn.className = 'treb-btn';
            }
          }
        },
        getParameters: () => ({
          fc: Number(toneCenter.value),
          Q: Number(toneQ.value),
          gain: Number(toneGain.value),
          stepPercent: Number(toneStep.value),
          duration: Number(microSweepDuration.value)
        })
      });
    } else {
      // Update config with current DOM element references
      sweepController.config.toneCenter = toneCenter;
      sweepController.config.toneQ = toneQ;
      sweepController.config.toneGain = toneGain;
      sweepController.config.sweepFStart = sweepFStart;
      sweepController.config.sweepFEnd = sweepFEnd;
    }

    if (!twoToneController) {
      twoToneController = new TwoToneReferenceController(audioCtx, outPreGain, {
        toneCenter,
        toneQ,
        toneGain,
        refFreq: document.getElementById('refFreqT'),
        noiseBW: document.getElementById('noiseBWT'),
        showHUD: showToneHUD,
        hideHUD: hideToneHUD,
        drawGraph: drawEQGraph,
        updateButtons: (isActive) => {
          if (!modeERBBands || !modeERBBands.checked) {
            if (isActive) {
              toneStartBtn.textContent = 'Stop';
              toneStartBtn.className = 'treb-btn secondary';
            } else {
              // Determine correct start text based on mode
              const isMicro = modeMicroSweep && modeMicroSweep.checked;
              const isToneNarrowBand = modeToneNarrowBand && modeToneNarrowBand.checked;
              const isToneWarble = modeToneWarble && modeToneWarble.checked;
              const is3TonePEQ = mode3TonePEQ && mode3TonePEQ.checked;

              let startText = 'Start';
              if (isMicro) startText = 'Start microSweep';
              else if (isToneNarrowBand) startText = 'Start Narrow Band';
              else if (isToneWarble) startText = 'Start Warble';
              else if (is3TonePEQ) startText = 'Start 3‑Tone';

              toneStartBtn.textContent = startText;
              toneStartBtn.className = 'treb-btn';
            }
          }
        },
        getPercentBounds,
        octaveBWToQ,
        biquadMagQ,
        sweepFStart,
        sweepFEnd
      });
    } else {
      // Update config with current DOM element references
      twoToneController.config.toneCenter = toneCenter;
      twoToneController.config.toneQ = toneQ;
      twoToneController.config.toneGain = toneGain;
      twoToneController.config.sweepFStart = sweepFStart;
      twoToneController.config.sweepFEnd = sweepFEnd;
    }
  }



  function redrawFiltersTable(){ if (!peqTable) return; peqTable.innerHTML = peqFilters.map((f,i)=>{
      const sel = (i===selectedFilterIndex)? ' style="background:rgba(63,169,245,0.08);"':'';
      return `<tr${sel}><td>${Math.round(f.fc)}</td><td>${Math.round(f.gain*10)/10}</td><td>${Math.round(f.q*10)/10}</td></tr>`;
    }).join(''); }

  function saveTrebleFilterToSelected(){
    // Special handling for ERB Bands mode - save currently selected band to a filter
    if (modeERBBands && modeERBBands.checked) {
      ensureControllers();
      if (!erbController) {
        console.warn('ERB controller not initialized.');
        return;
      }

      // Get the currently selected band
      const bandIndex = selectedERBBand;
      const bandLevel = erbController.getLevels()[bandIndex];

      // Only save if the band has been adjusted
      if (Math.abs(bandLevel) < 0.1) {
        console.warn('Selected ERB band has not been adjusted (gain is 0 dB).');
        return;
      }

      // Get adjusted bands and find the one matching our selection
      const adjustedBands = erbController.getAdjustedBands();
      const levels = erbController.getLevels();

      // Find which adjusted band corresponds to our selected band index
      let adjustedBandIndex = -1;
      let count = 0;
      for (let i = 0; i <= bandIndex; i++) {
        if (Math.abs(levels[i]) >= 0.1) {
          if (i === bandIndex) {
            adjustedBandIndex = count;
            break;
          }
          count++;
        }
      }

      if (adjustedBandIndex === -1 || !adjustedBands[adjustedBandIndex]) {
        console.warn('Could not retrieve band parameters.');
        return;
      }

      const { centerFreq, Q, gain } = adjustedBands[adjustedBandIndex];

      // Find an available filter or use the selected one
      let filterIdx = selectedFilterIndex >= 0 ? selectedFilterIndex : 0;
      let saved = false;

      while (filterIdx < peqFilters.length && !saved) {
        const f = peqFilters[filterIdx];
        const type = (f.type||'PK').toUpperCase();
        const isPK = (type==='PK'||type==='PEAK'||type==='PEAKING');
        const outOfRange = !(f.fc>=sweepFStart && f.fc<=sweepFEnd);
        const currentGain = Number(f.gain||f.G||0);
        const activeOutOfRange = outOfRange && Math.abs(currentGain) > 0.001;

        if (isPK && !activeOutOfRange) {
          f.type = 'PK';
          f.fc = centerFreq;
          f.q = Math.round(Q * 100) / 100;
          f.gain = Math.round(gain * 10) / 10;
          saved = true;
          selectedFilterIndex = filterIdx;
          break;
        }
        filterIdx++;
      }

      if (saved) {
        redrawFiltersTable();
        if (typeof renderFilterListFn === 'function') {
          requestAnimationFrame(()=>{ renderFilterListFn(); drawEQGraph(); });
        } else {
          drawEQGraph();
        }
        // Silently saved - no popup
        console.log(`Saved ERB band ${bandIndex} adjustment to filter ${filterIdx + 1}.`);
      } else {
        console.warn('No available PEQ filters found.');
      }
      return;
    }

    // Original logic for other modes
    if (selectedFilterIndex<0 || !peqFilters[selectedFilterIndex]){ alert('Please select a PEQ filter to save into.'); return; }
    // prevent saving into locked filters using the same rule as list rendering
    const fSel = peqFilters[selectedFilterIndex];
    const type = (fSel.type||'PK').toUpperCase();
    const notPK = !(type==='PK'||type==='PEAK'||type==='PEAKING');
    const outOfRange = !(fSel.fc>=sweepFStart && fSel.fc<=sweepFEnd);
    const gain = Number(fSel.gain||fSel.G||0);
    const activeOutOfRange = outOfRange && Math.abs(gain) > 0.001;
    if (notPK || activeOutOfRange){
      alert(notPK ? 'Selected filter is not a PK/Peaking type.' : 'Selected filter is locked because it is out of range with non-zero gain.');
      return;
    }
    const fc = Math.min(sweepFEnd, Math.max(sweepFStart, Math.round(Number(toneCenter.value))));
    const q = Math.max(0, Math.min(10, Number(toneQ.value)));
    const g = Math.round(Number(toneGain.value)*10)/10;
    const f = peqFilters[selectedFilterIndex];
    f.type = 'PK';
    f.fc = fc;
    f.q = q;
    f.gain = g;
    // Refresh the visible list (the legacy table is no longer primary UI)
    redrawFiltersTable();
    // Call the render function that is safely available in this scope
    if (typeof renderFilterListFn === 'function') {
      // Use RAF to ensure DOM is ready and keep selection scrolled into view
      requestAnimationFrame(()=>{ renderFilterListFn(); drawEQGraph(); });
    } else {
      drawEQGraph();
    }
  }

}
