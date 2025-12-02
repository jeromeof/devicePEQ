// Copyright 2025 : Pragmatic Audio

/**
 * SubjectizePEQ Plugin
 *
 * Provides a popup to map "subjective" sliders (MSEB-inspired) to concrete PEQ filters.
 * It discovers the current PEQ filters from the page (index.html demo layout), lets the user
 * select a target filter, and then apply one of the predefined subjective controls to it.
 *
 * Editable criteria for a PEQ filter:
 * - Gain is 0 dB, OR
 * - Frequency matches one of the predefined subjective control frequencies
 *   (still editable even if it has non-zero gain), OR
 * - (Optional) A disabled state if present on the element via data-disabled="true".
 *
 * Slider range: -100 .. +100 → mapped linearly to -10 .. +10 dB.
 */
async function initializeSubjectizePEQPlugin(context) {
  console.log("SubjectizePEQ Plugin initialized with context:", context);

  const SUBJECTIVE_DEFS = [
    // Note: Overall temperature is rendered last (bottom) via render logic below
    { key: 'bassExtension', label: 'Bass extension',      type: 'LSQ', freq: 70,   q: 0.7071 },
    { key: 'bassTexture',   label: 'Bass texture',        type: 'PK',  freq: 100,  q: 0.85   },
    { key: 'noteThickness', label: 'Note thickness',      type: 'PK',  freq: 200,  q: 0.6667 },
    { key: 'voice',         label: 'Vocal',               type: 'PK',  freq: 650,  q: 0.4    },
    { key: 'femaleOver',    label: 'Female overtones',    type: 'PK',  freq: 3000, q: 1.414  },
    { key: 'sibilLF',       label: 'Sibilance LF',        type: 'PK',  freq: 5800, q: 1.0    },
    { key: 'sibilHF',       label: 'Sibilance HF',        type: 'PK',  freq: 9200, q: 1.0    },
    { key: 'impulse',       label: 'Impulse',             type: 'PK',  freq: 7500, q: 0.4    },
    { key: 'air',           label: 'Air',                 type: 'HSQ', freq: 10000,q: 0.7071 },
    { key: 'overallTemp',  label: 'Overall temperature', type: 'DUAL', freq: 500,  q: 0.1, dual: true,
      low:  { type: 'LSQ', freq: 500, q: 0.1 },
      high: { type: 'HSQ', freq: 500, q: 0.1 }
    }
  ];

  const SUBJECTIVE_FREQS = new Set(SUBJECTIVE_DEFS.map(d => d.freq));
  const SUBJECTIVE_BY_FREQ = SUBJECTIVE_DEFS.reduce((m, d) => { m[d.freq] = d; return m; }, {});
  function getSubjectiveForFreq(freq) {
    const key = Math.round(Number(freq) || 0);
    return SUBJECTIVE_BY_FREQ[key] || null;
  }

  // Min/Max label texts for each subjective slider, per requirements
  const SUBJECTIVE_MIN_MAX = {
    overallTemp:   { min: 'Cool',     max: 'Warm'    },
    air:            { min: 'Soft',     max: 'Crisp'   },
    impulse:        { min: 'slow',     max: 'fast'    },
    sibilHF:        { min: 'Soft',     max: 'Crisp'   },
    sibilLF:        { min: 'Soft',     max: 'Crisp'   },
    femaleOver:     { min: 'Recessed', max: 'Forward' },
    voice:          { min: 'Recessed', max: 'Forward' }, // labeled "Vocal" in UI
    noteThickness:  { min: 'Thick',    max: 'Crisp'   },
    bassTexture:    { min: 'fast',     max: 'Thump'   },
    bassExtension:  { min: 'light',    max: 'Thump'   }
  };

  // Mount button with configurable placement (mirrors VisualizePEQ approach)
  const cfg = (context && context.config) || {};
  const subjCfg = cfg.subjectizePEQ || {};
  const renderCfg = cfg.renderPEQ || {};

  // Support both legacy "position" and new top-level subjectizePEQAnchorDiv/subjectizePEQPlacement
  const legacyPosition = subjCfg.position || renderCfg.position || null;
  let placement = 'afterend';
  let anchorSelector = '.extra-eq';

  if (cfg && typeof cfg.subjectizePEQPlacement === 'string') {
    placement = cfg.subjectizePEQPlacement;
  }
  if (cfg && typeof cfg.subjectizePEQAnchorDiv === 'string') {
    anchorSelector = cfg.subjectizePEQAnchorDiv;
  }

  function resolveAnchor() {
    // Prefer explicit selector from config
    if (anchorSelector) {
      const el = document.querySelector(anchorSelector);
      if (el) return el;
    }
    // Fallback to legacy position by id or selector
    if (legacyPosition && typeof legacyPosition === 'string') {
      if (/^[#.]/.test(legacyPosition)) {
        const bySel = document.querySelector(legacyPosition);
        if (bySel) return bySel;
      }
      const byId = document.getElementById(legacyPosition.replace(/^#/, ''));
      if (byId) return byId;
    }
    // Final fallbacks
    return (
      document.querySelector('.extra-eq') ||
      document.getElementById('peq-controls') ||
      document.body
    );
  }

  const anchor = resolveAnchor();

  // Optional container and inline styles, mirroring visualizePEQ behavior
  const injectStyles = (cfg && cfg.subjectizePEQInjectStyles) !== false; // default true
  const container = document.createElement('div');
  container.className = 'subjectize-peq-container';
  container.id = 'subjectizePEQArea';

  if (injectStyles) {
    const style = document.createElement('style');
    style.textContent = `
      /* SubjectizePEQ button + container styling */
      .subjectize-peq-container {
        display: inline-block; /* sit next to visualize button */
        margin: 8px 0 8px 8px;  /* tighten vertical space; ensure small gap to the left */
        vertical-align: middle;
      }
      .subjectizePEQ-control-btn, .visualizePEQ-control-btn { margin-right: 8px; }
      .subjectize-peq-container .selected { color: #00ccff; }

      /* Header buttons */
      #applySubjectizePEQOverlay {
        background-color: #f8f8f8 !important;
        color: #333 !important;
        border: 1px solid #ddd !important;
        font-weight: 600;
      }

      /* Match VisualizePEQ slider styling */
      .hrange {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 44px;
        background: transparent;
      }
      .hrange::-webkit-slider-runnable-track {
        height: 18px;
        background: #333;
        border-radius: 9px;
        border: 1px solid #444;
      }
      .hrange::-moz-range-track {
        height: 18px;
        background: #333;
        border-radius: 9px;
        border: 1px solid #444;
      }
      .hrange::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: #ffcc00;
        border: 1px solid #b38f00;
        margin-top: -5px;
      }
      .hrange::-moz-range-thumb {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: #ffcc00;
        border: 1px solid #b38f00;
      }
      .hrange:focus { outline: none; }
      .hrange:focus::-webkit-slider-runnable-track { box-shadow: 0 0 0 2px rgba(255,204,0,0.25); }
      .hrange:focus::-moz-range-track { box-shadow: 0 0 0 2px rgba(255,204,0,0.25); }
      .hrange::-webkit-slider-thumb:active { transform: scale(1.1); }

      /* Subjectize filter list rows to match VisualizePEQ palette */
      .subjectize-filter-row { 
        border: 1px solid #333; 
        border-radius: 6px; 
        background: #1a1a1a; 
      }
      .subjectize-filter-row.locked {
        border-color: #553;
        background: #2a1a1a;
        cursor: not-allowed;
      }
      .subjectize-filter-row.selected {
        outline: 2px solid #00ccff;
      }
    `;
    container.appendChild(style);
  }

  const btn = document.createElement('button');
  btn.textContent = subjCfg.buttonText || 'Subjectizer';
  // Preserve existing default class for backward CSS, also add a subjectize-specific class
  const defaultBtnClass = subjCfg.buttonClass || 'visualizePEQ-control-btn';
  btn.className = `${defaultBtnClass} subjectizePEQ-control-btn`;
  btn.addEventListener('click', openOverlay);
  container.appendChild(btn);

  if (subjCfg.enabled !== false) {
    // Insert near the anchor using the configured placement (like visualizePEQ)
    if (anchor && typeof anchor.insertAdjacentElement === 'function') {
      try {
        anchor.insertAdjacentElement(placement, container);
      } catch (e) {
        // If placement keyword is invalid for this anchor context, fall back
        anchor.appendChild(container);
      }
    } else if (anchor) {
      anchor.appendChild(container);
    } else {
      document.body.appendChild(container);
    }
  }

  // Note: Removed legacy DOM scraping of filters (readFiltersFromPage).

  // Create overlay elements once
  let overlayBackdrop = null;
  let overlay = null;
  let leftPaneRef = null;
  let state = {
    filters: [],
    selectedFilterIndex: null,
    currentSubjectiveKey: SUBJECTIVE_DEFS[0].key,
    sliderValue: 0,
    advanced: false
  };

  // Restore advanced mode from localStorage if available
  try {
    const saved = localStorage.getItem('subjectizePEQ.advanced');
    if (saved === 'true' || saved === 'false') {
      state.advanced = (saved === 'true');
    }
  } catch (e) {
    // ignore
  }

  // Load filters the same way visualizePEQ does: via context.elemToFilters only.
  function loadFiltersFromContextOrPage() {
    let filters = [];
    // Attempt context-based extraction first (like visualizePEQ)
    try {
      const src = (context && typeof context.elemToFilters === 'function') ? context.elemToFilters(true) : [];
      const mapped = (src || []).filter(f => !f.disabled).map(f => ({
        type: f.type || 'PK',
        freq: Number(f.freq) || 1000,
        gain: Number(f.gain) || 0,
        q: Number(f.q != null ? f.q : f.Q) || 1,
        disabled: !!f.disabled
      }));
      // If we successfully obtained filters, attach index + hostEl to match Subjectize needs
      if (mapped.length) {
        const domItems = Array.from(document.querySelectorAll('#filter-list .filter-item'));
        filters = mapped.map((f, idx) => ({
          ...f,
          index: idx,
          hostEl: domItems[idx] || null
        }));
      }
    } catch (e) {
      console.warn('elemToFilters failed in SubjectizePEQ:', e);
      filters = [];
    }
    return filters;
  }

  function buildOverlay() {
    overlayBackdrop = document.createElement('div');
    overlayBackdrop.className = 'peq-overlay-backdrop';
    overlayBackdrop.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9998;`;
    overlayBackdrop.addEventListener('click', (e) => {
      if (e.target === overlayBackdrop) closeOverlay();
    });

    overlay = document.createElement('div');
    overlay.className = 'peq-overlay';
    overlay.style.cssText = `position:fixed;inset:0;margin:auto;background:#111;color:#ddd;width:95vw;max-width:1100px;height:85vh;border:1px solid #333;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.5);z-index:9999;`;

    // Add responsive styles to mimic visualizePEQ fullscreen tweaks on mobile
    const style = document.createElement('style');
    style.textContent = `
      /* SubjectizePEQ layout: ensure side-by-side columns by default */
      .peq-overlay-body.subjectize-grid { display: flex !important; flex-direction: row !important; }

      /* SubjectizePEQ responsive tweaks */
      @media (max-width: 768px) {
        .peq-overlay.subjectize { width: 100vw !important; height: 100vh !important; max-width: none !important; border-radius: 0 !important; }
        .peq-overlay-body.subjectize-grid { flex-direction: column !important; padding: 8px !important; }
        .subjectize-left { flex: 0 0 auto !important; max-height: 44vh; padding-right: 0 !important; border-right: none !important; border-bottom: 1px solid #222 !important; }
        .subjectize-right { padding-left: 0 !important; }
        .subj-card button { padding: 10px 12px; }
        .subj-card input[type="range"] { height: 28px; }
      }
    `;
    document.head.appendChild(style);
    overlay.classList.add('subjectize');

    // Header
    const header = document.createElement('div');
    header.className = 'peq-overlay-header';
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #333;';
    header.innerHTML = `<div style="font-weight:600">Subjectize PEQ</div>`;
    const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', closeOverlay);
      // Apply button – pushes filters back to parent and closes overlay
    const applyBtn = document.createElement('button');
    applyBtn.id = 'applySubjectizePEQOverlay';
      applyBtn.textContent = 'Apply';
      applyBtn.style.marginLeft = '8px';
      applyBtn.addEventListener('click', () => {
      try {
        // Build a plain array of filters from current state
        const out = (state.filters || []).map(f => ({
          type: f.type || 'PK',
          freq: Math.floor(Number(f.freq) || 1000),
          gain: Math.round((Number(f.gain) || 0) * 10) / 10,
          q: Math.round((Number(f.q) || 1) * 10) / 10,
          disabled: false
        }));
        if (context && typeof context.filtersToElem === 'function') {
          context.filtersToElem(out);
        }
        // Apply EQ if available
        if (context && typeof context.applyEQ === 'function') {
          try { context.applyEQ(); } catch (_) {}
        }
        // Notify other components, if any
        try { document.dispatchEvent(new CustomEvent('UpdateExtensionFilters')); } catch (_) {}
      } catch (e) {
        console.error('SubjectizePEQ Apply failed:', e);
      }
      closeOverlay();
    });
    // Advanced mode toggle (default OFF)
    const advWrap = document.createElement('div');
    advWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const advLabel = document.createElement('label');
    advLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
    const advToggle = document.createElement('input');
    advToggle.type = 'checkbox';
    advToggle.checked = !!state.advanced;
    const advText = document.createElement('span');
    advText.textContent = 'Advanced mode';
    advLabel.appendChild(advToggle);
    advLabel.appendChild(advText);
    advWrap.appendChild(advLabel);
    advWrap.appendChild(applyBtn);
    advWrap.appendChild(closeBtn);
    header.appendChild(advWrap);

    advToggle.addEventListener('change', () => {
      state.advanced = !!advToggle.checked;
      try { localStorage.setItem('subjectizePEQ.advanced', String(state.advanced)); } catch(_) {}
      renderFilterList();
      renderSubjectiveCards();
      applyLeftPaneSizing();
      // After re-rendering cards for mode change, re-sync slider value from selected filter
      try { syncSlidersFromSelectedFilter(); } catch(_) {}
    });

    // Body
    const body = document.createElement('div');
    body.className = 'peq-overlay-body subjectize-grid';
    body.style.cssText = 'flex:1;display:flex;gap:10px;min-height:0;padding:10px;';

    // Left: filter list
    const left = document.createElement('div');
    left.className = 'subjectize-left';
    left.style.cssText = 'flex:0 0 40%;overflow:auto;border-right:1px solid #222;padding-right:10px;';
    left.innerHTML = '<div style="margin:0 0 8px 0;font-weight:600">Existing PEQ Filters</div>';
    const filterList = document.createElement('div');
    filterList.id = 'subjectize-filter-list';
    left.appendChild(filterList);
    leftPaneRef = left;

    // Right: subjective controls
    const right = document.createElement('div');
    right.className = 'subjectize-right';
    right.style.cssText = 'flex:1;overflow:auto;padding-left:10px;display:flex;flex-direction:column;gap:10px;';

    const subjHeader = document.createElement('div');
    subjHeader.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    subjHeader.innerHTML = '<div style="font-weight:600">Subjectivity Control — inspired by MSEB by Hiby</div>';

    // Introductory explanation
    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:13px;opacity:0.9;line-height:1.35;background:#151515;border:1px solid #2a2a2a;border-radius:6px;padding:8px;';
    intro.innerHTML = `
      <strong>How it works:</strong> Select a filter from the list on the left, then pick one of the subjective tweaks below and set how strongly it should apply.
      Use the slider to choose the intensity. In basic mode you’ll see a scale of -100 to +100. In Advanced mode you can also see and apply the exact filter type, frequency, Q, and dB value.`;

    const subjGrid = document.createElement('div');
    subjGrid.id = 'subjective-grid';
    // Slightly tighter grid to fit more cards on screen in simple mode
    subjGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;';

    // Defer cards content to renderer so we can react to Advanced toggle
    function renderSubjectiveCards() {
      subjGrid.innerHTML = '';
      // ensure Overall temperature is rendered last and with larger card
      const defs = [...SUBJECTIVE_DEFS];
      defs.sort((a,b)=> (a.key==='overallTemp') - (b.key==='overallTemp'));
      defs.forEach(def => {
        const card = document.createElement('div');
        card.className = 'subj-card';
        // Make Overall temperature card larger and full width
        // In simple mode (not advanced) we reduce paddings/gaps a bit to fit more
        const basePad = state.advanced ? 10 : 8;
        const baseGap = state.advanced ? 6 : 4;
        const baseCardCss = `border:1px solid #333;border-radius:6px;padding:${basePad}px;background:#121212;display:flex;flex-direction:column;gap:${baseGap}px;`;
        if (def.dual) {
          const dualPad = state.advanced ? 14 : 10;
          card.style.cssText = baseCardCss + `grid-column:1 / -1; padding:${dualPad}px;`;
        } else {
          card.style.cssText = baseCardCss;
        }

        // Title row (name on the left). In simple mode, show value on the right inline.
        const title = document.createElement('div');
        title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
        const titleLeft = document.createElement('div');
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = '600';
        nameSpan.textContent = def.label;
        titleLeft.appendChild(nameSpan);
        if (state.advanced) {
          const details = document.createElement('div');
          details.style.cssText = 'opacity:0.7; font-size:12px;';
          if (def.dual) {
            details.textContent = `${def.low.type} @ ${def.low.freq} Hz, Q ${def.low.q}  +  ${def.high.type} @ ${def.high.freq} Hz, Q ${def.high.q}`;
          } else {
            details.textContent = `${def.type} @ ${def.freq} Hz, Q ${def.q}`;
          }
          // stack details under name in advanced
          const titleStack = document.createElement('div');
          titleStack.style.display = 'flex';
          titleStack.style.flexDirection = 'column';
          titleStack.style.gap = '2px';
          titleStack.appendChild(nameSpan);
          titleStack.appendChild(details);
          titleLeft.innerHTML = '';
          titleLeft.appendChild(titleStack);
        }
        title.appendChild(titleLeft);

        // Right-side readout for simple mode
        const headerReadout = document.createElement('span');
        headerReadout.style.cssText = 'font-size:12px;opacity:0.85;';
        if (!state.advanced) {
          headerReadout.textContent = '0';
          title.appendChild(headerReadout);
        }

        // Slider with min/max semantic labels
        const sliderRow = document.createElement('div');
        const rowGap = state.advanced ? 8 : 6;
        sliderRow.style.cssText = `display:flex;align-items:center;gap:${rowGap}px;`;
        const mm = SUBJECTIVE_MIN_MAX[def.key] || { min: 'Min', max: 'Max' };
        const minLabel = document.createElement('span');
        minLabel.textContent = mm.min;
        minLabel.style.cssText = 'font-size:12px;opacity:0.8;white-space:nowrap;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'hrange';
        slider.min = -100; slider.max = 100; slider.step = 1; slider.value = 0;
        slider.dataset.key = def.key;
        slider.style.cssText = 'flex:1;';

        const maxLabel = document.createElement('span');
        maxLabel.textContent = mm.max;
        maxLabel.style.cssText = 'font-size:12px;opacity:0.8;white-space:nowrap;';

        // Under-slider readout only for advanced mode
        const readout = document.createElement('div');
        readout.style.cssText = 'font-size:12px;opacity:0.85;';
        if (state.advanced) {
          readout.textContent = '0.0 dB';
        }

        slider.addEventListener('input', () => {
          const val = Number(slider.value);
          if (state.advanced) {
            const gain = (val / 100) * 10; // map to ±10 dB
            readout.textContent = `${gain.toFixed(1)} dB`;
          } else {
            headerReadout.textContent = `${val}`; // show -100..100 scale in header
          }
        });

        // Apply button(s)
        let applyWrap;
        if (def.dual) {
          // For Overall temperature, provide two buttons to apply either LOW (LSQ) or HIGH (HSQ)
          applyWrap = document.createElement('div');
          applyWrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

          const lowBtn = document.createElement('button');
          lowBtn.textContent = 'Apply lower temperature filter (LSQ)';
          lowBtn.addEventListener('click', () => {
            const mapped = (Number(slider.value) / 100) * 10; // ±10 dB; Warm positive boosts bass
            applySingleSpecToSelected(def.low, mapped);
          });

          const highBtn = document.createElement('button');
          highBtn.textContent = 'Apply upper temperature filter (HSQ)';
          highBtn.addEventListener('click', () => {
            const mapped = (Number(slider.value) / 100) * 10; // ±10 dB
            // Upper tilt is opposite sign to create complementary tilt when combined
            applySingleSpecToSelected(def.high, -mapped);
          });

          applyWrap.appendChild(lowBtn);
          applyWrap.appendChild(highBtn);
        } else {
          const applyBtn = document.createElement('button');
          applyBtn.textContent = 'Apply to selected filter';
          applyBtn.addEventListener('click', () => {
            applySubjectiveToSelected(def, Number(slider.value));
          });
          applyWrap = applyBtn;
        }

        card.appendChild(title);
        sliderRow.appendChild(minLabel);
        sliderRow.appendChild(slider);
        sliderRow.appendChild(maxLabel);
        card.appendChild(sliderRow);
        if (state.advanced) {
          card.appendChild(readout);
        }
        card.appendChild(applyWrap);
        subjGrid.appendChild(card);
      });
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;opacity:0.8;';
    hint.textContent = 'Tip: Select a target filter from the list on the left. Locked filters are not editable because they use non-subjective frequencies and non-zero gain.';

    right.appendChild(subjHeader);
    right.appendChild(intro);
    right.appendChild(subjGrid);
    right.appendChild(hint);

    body.appendChild(left);
    body.appendChild(right);

    overlay.appendChild(header);
    overlay.appendChild(body);

    overlayBackdrop.appendChild(overlay);
    document.body.appendChild(overlayBackdrop);

    // Initial render of subjective cards according to advanced state
    renderSubjectiveCards();
    applyLeftPaneSizing();
  }

  function openOverlay() {
    state.filters = loadFiltersFromContextOrPage();
    // Align selection behavior with visualizePEQ: default to first filter when available
    state.selectedFilterIndex = state.filters.length ? 0 : null;
    if (!overlayBackdrop) buildOverlay();
    renderFilterList();
    overlayBackdrop.style.display = 'flex';
    applyLeftPaneSizing();
    // Sync sliders from the selected filter (if any) so values reflect existing gain
    try { syncSlidersFromSelectedFilter(); } catch(_) {}
  }

  function closeOverlay() {
    if (overlayBackdrop) overlayBackdrop.style.display = 'none';
  }

  function isEditableFilter(f) {
    if (f.disabled) return true;
    if (Math.abs(f.gain) === 0) return true;
    if (SUBJECTIVE_FREQS.has(Math.round(f.freq))) return true;
    return false;
  }

  function renderFilterList() {
    const container = overlay.querySelector('#subjectize-filter-list');
    container.innerHTML = '';
    state.filters.forEach(f => {
      const row = document.createElement('div');
      const editable = isEditableFilter(f);
      // Make rows slightly more compact in basic mode to fit more items
      const rowPad = state.advanced ? 8 : 6;
      row.className = 'subjectize-filter-row' + (editable ? '' : ' locked');
      row.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:${rowPad}px;margin-bottom:6px;cursor:${editable ? 'pointer' : 'not-allowed'};`;
      const left = document.createElement('div');
      const subj = getSubjectiveForFreq(f.freq);
      left.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';

      // Line 1: primary title/details
      const line1 = document.createElement('div');
      if (state.advanced) {
        line1.innerHTML = `<span style="font-weight:600">Filter ${f.index + 1}</span> · ${f.type} · ${f.freq} Hz · ${f.gain} dB · Q ${f.q}`;
      } else {
        line1.innerHTML = `<span style="font-weight:600">Filter ${f.index + 1}</span>`;
      }
      left.appendChild(line1);

      // Line 2: subjective tweak name (if any), always placed underneath
      if (subj) {
        const line2 = document.createElement('div');
        line2.innerHTML = `<span style="color:#bbb; font-size:12px;">${subj.label}</span>`;
        left.appendChild(line2);
      }
      const right = document.createElement('div');
      right.style.cssText = 'font-size:12px;opacity:0.8;';
      right.textContent = editable ? (state.selectedFilterIndex === f.index ? 'Selected' : 'Editable') : 'Locked';
      if (state.selectedFilterIndex === f.index) {
        row.classList.add('selected');
      }
      if (editable) {
        row.addEventListener('click', () => {
          state.selectedFilterIndex = f.index;
          renderFilterList();
          // When selection changes, reflect current filter gain onto matching subjective slider
          try { syncSlidersFromSelectedFilter(); } catch(_) {}
        });
      }
      row.appendChild(left);
      row.appendChild(right);
      container.appendChild(row);
    });
  }

  // Helper shared writer
  function writeToFilter(filterObj, newVals) {
    const el = filterObj.hostEl;

    // Sanitize incoming values and update local cache/state first
    const next = {
      type: newVals.type || filterObj.type || 'PK',
      freq: Math.floor(Number(newVals.freq != null ? newVals.freq : filterObj.freq) || 1000),
      gain: Number((Number(newVals.gain != null ? newVals.gain : filterObj.gain) || 0).toFixed(2)),
      q: Number(newVals.q != null ? newVals.q : filterObj.q || 1)
    };

    filterObj.type = next.type;
    filterObj.freq = next.freq;
    filterObj.gain = next.gain;
    filterObj.q = next.q;

    // If we have corresponding DOM, update it (legacy pages)
    if (el) {
      const typeEl = el.querySelector('.filter-type');
      const freqEl = el.querySelector('.filter-freq');
      const gainEl = el.querySelector('.filter-gain');
      const qEl = el.querySelector('.filter-q');
      if (typeEl) typeEl.value = next.type;
      if (freqEl) freqEl.value = String(next.freq);
      if (gainEl) gainEl.value = String(Number(next.gain.toFixed(2)));
      if (qEl) qEl.value = String(next.q);
      return;
    }

    // No host element: push changes back via context immediately so Apply buttons work
    try {
      if (context && typeof context.filtersToElem === 'function') {
        const out = (state.filters || []).map(f => ({
          type: f.type || 'PK',
          freq: Math.floor(Number(f.freq) || 1000),
          gain: Math.round((Number(f.gain) || 0) * 10) / 10, // align with header Apply formatting
          q: Math.round((Number(f.q) || 1) * 10) / 10,
          disabled: !!f.disabled
        }));
        context.filtersToElem(out);
        if (typeof context.applyEQ === 'function') {
          try { context.applyEQ(); } catch(_) {}
        }
        try { document.dispatchEvent(new CustomEvent('UpdateExtensionFilters')); } catch(_) {}
      }
    } catch (e) {
      console.warn('[SubjectizePEQ] Failed to push context filters:', e);
    }
  }

  function applySingleSpecToSelected(spec, gain) {
    const idx = state.selectedFilterIndex;
    if (idx == null) {
      alert('Please select a target filter from the list on the left.');
      return;
    }
    const f = state.filters[idx];
    if (!isEditableFilter(f)) {
      alert('Selected filter is locked and cannot be edited. Choose another filter.');
      return;
    }
    writeToFilter(f, { type: spec.type, freq: spec.freq, q: spec.q, gain });
    renderFilterList();
  }

  function applySubjectiveToSelected(def, sliderVal) {
    const idx = state.selectedFilterIndex;
    if (idx == null) {
      alert('Please select a target filter from the list on the left.');
      return;
    }
    const f = state.filters[idx];
    if (!isEditableFilter(f)) {
      alert('Selected filter is locked and cannot be edited. Choose another filter.');
      return;
    }

    const gain = (sliderVal / 100) * 10; // ±10 dB

    if (def.dual) {
      // For Overall temperature, use the dedicated buttons on the card to apply either LOW or HIGH to the selected filter.
      alert('Overall temperature uses two separate Apply buttons: use the lower/upper button to apply to the selected filter.');
      return;
    }

    // Single filter subjective
    writeToFilter(f, { type: def.type, freq: def.freq, q: def.q, gain });
    renderFilterList();
  }

  function applyLeftPaneSizing() {
    if (!leftPaneRef) return;
    // In basic mode make the list thinner to show more subjective cards
    if (!state.advanced) {
      leftPaneRef.style.flex = '0 0 220px';
      leftPaneRef.style.minWidth = '180px';
    } else {
      leftPaneRef.style.flex = '0 0 40%';
      leftPaneRef.style.minWidth = '';
    }
  }

  // Map currently selected filter's gain to the corresponding subjective slider so users can edit
  function syncSlidersFromSelectedFilter() {
    if (state.selectedFilterIndex == null) return;
    const f = state.filters[state.selectedFilterIndex];
    if (!f) return;
    const def = getSubjectiveForFreq(f.freq);
    if (!def) return; // not a subjective-mapped frequency

    // Compute slider value from gain: slider [-100..100] <-> gain [-10..10] dB
    let sliderVal;
    if (def.key === 'overallTemp') {
      // For overall temperature, the single slider maps to two filters:
      // LSQ (low) uses +mapped, HSQ (high) uses -mapped to be complementary.
      const mapped = (Number(f.gain) / 10) * 100;
      const type = String(f.type || '').toUpperCase();
      if (type === 'HS' || type === 'HSQ' || type === 'HSH') {
        sliderVal = -mapped;
      } else {
        // Treat anything else as the low shelf side
        sliderVal = mapped;
      }
    } else {
      sliderVal = (Number(f.gain) / 10) * 100;
    }

    // Clamp
    sliderVal = Math.max(-100, Math.min(100, Math.round(sliderVal)));

    // Find the slider element for this subjective definition and set its value
    const grid = document.getElementById('subjective-grid');
    if (!grid) return;
    const slider = grid.querySelector(`input[type="range"][data-key="${def.key}"]`);
    if (!slider) return;
    slider.value = String(sliderVal);
    // Trigger its input handler so readouts (header or dB) update accordingly
    slider.dispatchEvent(new Event('input'));
  }
}

// CommonJS export (for tests / Node bundlers)
if (typeof module !== 'undefined') {
  module.exports = initializeSubjectizePEQPlugin;
}

// ESM export (for modern browsers/builds)
export default initializeSubjectizePEQPlugin;
