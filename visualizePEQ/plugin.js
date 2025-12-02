// Copyright 2024 : Pragmatic Audio

/**
 * Initialise the VisualizePEQ plugin - provides interactive frequency response visualization
 * with parametric EQ filter editing capabilities
 *
 * // where phoneObj and targetObj have this structure:
 * const phoneObj = { rawChannels: [{freq: 20, spl: 0, phase: 0}, ...] };
 * const targetObj = { rawChannels: [{freq: 20, spl: 0, phase: 0}, ...] };
 * const alignmentFreq = 1000; // Hz - optional alignment/normalization frequency
 * const limits = { maxGain: 12, minGain: -12, minQ: 0.2, maxQ: 10 }; // optional limits (defaults shown)
 *
 * @returns {Promise<void>}
 */
async function initializeVisualizePEQPlugin(context) {
  console.log("VisualizePEQ Plugin initialized with context:", context);

  function loadHtml() {
    // Set default values for configuration
    var placement = 'afterend';
    var anchorDiv = '.extra-eq';

    // Override with context config values if available
    if (context && context.config) {
      if (context.config.visualizePEQPlacement) {
        placement = context.config.visualizePEQPlacement;
      }
      if (context.config.visualizePEQAnchorDiv) {
        anchorDiv = context.config.visualizePEQAnchorDiv;
      }
    }

    const visualizePEQHTML = `
      <div class="visualize-peq-container" id="visualizePEQArea">
        <style>
            /* Apply button override */
            #applyPEQOverlay {
                background-color: #f8f8f8 !important;
                color: #333 !important;
                border: 1px solid #ddd !important;
                font-weight: 600;
            }

            /* General context */
            .visualize-peq-container { margin: 20px 0; }
            .visualizePEQ-control-btn { margin-right: 8px; }
            .selected { color: #00ccff; }

            /* ------------------------------------------------------------------
               OVERLAY BACKDROP (covers entire viewport)
            ------------------------------------------------------------------ */
            .peq-overlay-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.6);
                display: none;                      /* shown via JS */
                align-items: center;
                justify-content: center;
                z-index: 9998;
            }

            /* ------------------------------------------------------------------
               MAIN OVERLAY PANEL
               Anchor it to the viewport using 'position: fixed'.
            ------------------------------------------------------------------ */
            .peq-overlay {
                position: fixed;                    /* ← REQUIRED FIX */
                inset: 0;                           /* anchor to viewport */
                margin: auto;                       /* center on desktop */
                background: #111;
                color: #ddd;

                width: 95vw;
                max-width: 1200px;
                height: 90vh;

                border: 1px solid #333;
                border-radius: 8px;

                display: flex;
                flex-direction: column;

                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                z-index: 9999;                      /* above backdrop */
            }

            /* Header */
            .peq-overlay-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 14px;
                border-bottom: 1px solid #333;
                flex-shrink: 0;
            }

            /* Body */
            .peq-overlay-body {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding: 8px 14px 10px 14px;
                overflow-y: auto;
                min-height: 0;
            }

            /* Chart container */
            .peq-chart {
                width: 100%;
                height: 60vh;
                min-height: 350px;
                cursor: crosshair;
                flex-shrink: 0;
            }

            /* Bottom spacing */
            .peq-bottom { margin-top:10px; }

            /* Sliders */
            .peq-sliders {
                display: none;
                margin-top: 8px;
            }
            .peq-sliders .slider-panel {
                display: flex;
                gap: 24px;
                align-items: stretch;
                justify-content: space-around;
            }
            .peq-sliders .slider-col {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 10px;
                min-width: 260px;
            }
            .peq-sliders .slider-col label {
                font-size: 12px;
                color: #bbb;
                text-align: center;
            }
            .peq-sliders .value {
                min-height: 18px;
                text-align: center;
                color: #ddd;
                font-variant-numeric: tabular-nums;
            }

            /* Slider styling */
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

            /* Focus glow */
            .hrange:focus::-webkit-slider-runnable-track { box-shadow: 0 0 0 2px rgba(255,204,0,0.25); }
            .hrange:focus::-moz-range-track { box-shadow: 0 0 0 2px rgba(255,204,0,0.25); }

            .hrange::-webkit-slider-thumb:active { transform: scale(1.1); }

            /* Footer */
            .peq-overlay-footer {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                border-top: 1px solid #333;
                padding: 10px 14px;
                flex-shrink: 0;
            }

            .peq-btn {
                padding: 6px 12px;
                cursor: pointer;
                border: 1px solid #444;
                background: #222;
                color: #ddd;
                border-radius: 4px;
                min-height: 44px;
            }

            .peq-btn.primary {
                background: #0a84ff;
                border-color: #086ad1;
                color: #fff;
            }

            /* Filter type radio as centered buttons */
            .peq-type-group {
                display: flex;
                justify-content: center;           /* center horizontally */
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            .peq-type-option {
                position: relative;
                user-select: none;
            }
            .peq-type-option input {
                position: absolute;
                opacity: 0;
                pointer-events: none;
                width: 1px; height: 1px;          /* keep in DOM for a11y */
            }
            .peq-type-btn {
                display: inline-block;
                padding: 8px 14px;
                min-width: 64px;
                text-align: center;
                border: 1px solid #555;
                border-radius: 22px;               /* pill shape */
                background: #1e1e1e;              /* high contrast on black */
                color: #eee;
                font-weight: 600;
                letter-spacing: 0.3px;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(0,0,0,0.4) inset,
                            0 1px 0 rgba(255,255,255,0.05);
                transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
            }
            .peq-type-option input:focus + .peq-type-btn {
                outline: 2px solid #0a84ff;
                outline-offset: 2px;
            }
            .peq-type-option input:hover + .peq-type-btn,
            .peq-type-btn:hover {
                background: #262626;
                border-color: #777;
            }
            .peq-type-option input:checked + .peq-type-btn {
                background: #0a84ff;               /* active color */
                border-color: #086ad1;
                color: #fff;
                box-shadow: 0 0 0 2px rgba(10,132,255,0.25);
            }

            /* ------------------------------------------------------------------
               RESPONSIVE DESIGN (Mobile)
            ------------------------------------------------------------------ */
            @media (max-width: 768px) {
                .peq-overlay-backdrop {
                    align-items: stretch;
                    justify-content: stretch;
                    padding: 0;
                }

                .peq-overlay {
                    width: 100vw;
                    height: 100vh;
                    max-width: 100vw;
                    max-height: 100vh;
                    border-radius: 0;
                    margin: 0;                /* ensure full stretch */
                }

                .peq-overlay-header {
                    padding: 12px;
                }
                .peq-overlay-header #peqOverlayTitle {
                    font-size: 16px;
                    font-weight: bold;
                }

                .peq-overlay-body { padding: 8px; }

                .peq-chart {
                    height: 40vh;
                    min-height: 250px;
                }

                /* Mobile slider stack */
                .peq-sliders { margin-top: 4px; }
                .peq-sliders .slider-panel {
                    flex-direction: column;
                    gap: 8px;
                }
                .peq-sliders .slider-col {
                    min-width: unset;
                    width: 100%;
                    max-width: 100%;
                    gap: 4px;
                }
                .peq-sliders .slider-col label { font-size: 11px; }
                .peq-sliders .value { min-height: 16px; font-size: 13px; }

                /* Smaller touch targets */
                .hrange { height: 32px; max-width: 100%; }
                .hrange::-webkit-slider-runnable-track {
                    height: 12px; border-radius: 6px;
                }
                .hrange::-moz-range-track {
                    height: 12px; border-radius: 6px;
                }
                .hrange::-webkit-slider-thumb {
                    width: 28px; height: 28px; margin-top: -8px;
                }
                .hrange::-moz-range-thumb {
                    width: 28px; height: 28px;
                }

                /* Footer buttons */
                .peq-overlay-footer {
                    padding: 12px;
                    gap: 12px;
                }
                .peq-btn {
                    padding: 12px 20px;
                    font-size: 16px;
                    min-height: 48px;
                    flex: 1;
                }
            }

            @media (max-width: 480px) {
                .peq-chart {
                    height: 35vh;
                    min-height: 200px;
                }
                .peq-overlay-header {
                    font-size: 14px;
                }
            }
        </style>

        <button id="openPEQOverlay" class="visualizePEQ-control-btn">${(context && context.config && context.config.visualizePEQ && context.config.visualizePEQ.buttonText) || 'Visualize PEQ'}</button>

        <!-- Overlay markup -->
        <div id="peqOverlayBackdrop" class="peq-overlay-backdrop">
          <div class="peq-overlay" role="dialog" aria-modal="true" aria-labelledby="peqOverlayTitle">
            <div class="peq-overlay-header">
              <div id="peqOverlayTitle">PEQ Visualizer: Click on 'Dot' on chart to change, press 'Q' or 'W' to alter qValues, 'T' to toggle filter type</div>
            </div>
            <div class="peq-overlay-body">
              <div id="peqChart" class="peq-chart"></div>

              <!-- Bottom sliders for selected PEQ -->
              <div id="peqSliders" class="peq-sliders">
                <div class="slider-panel">
                  <div class="slider-col">
                    <span class="value" id="peqFreqVal">—</span>
                    <input type="range" id="peqFreqSlider" class="hrange" min="0" max="100" step="0.1">
                    <label for="peqFreqSlider">Frequency (Hz)</label>
                  </div>
                  <div class="slider-col">
                    <span class="value" id="peqGainVal">—</span>
                    <input type="range" id="peqGainSlider" class="hrange" step="0.1">
                    <label for="peqGainSlider">Gain (dB)</label>
                  </div>
                  <div class="slider-col">
                    <span class="value" id="peqQVal">—</span>
                    <input type="range" id="peqQSlider" class="hrange" step="0.01">
                    <label for="peqQSlider">Q</label>
                  </div>
                </div>
                <!-- Filter type radio group for mobile/desktop -->
                <div class="slider-panel" id="peqTypePanel" style="margin-top:8px; align-items:center;">
                  <div class="slider-col" style="flex:1 1 100%;">
                    <label style="display:block; margin-bottom:6px;">Filter type</label>
                    <div role="radiogroup" aria-label="Filter type" class="peq-type-group">
                      <label class="peq-type-option"><input type="radio" name="peqType" id="peqTypePK" value="PK"><span class="peq-type-btn">PK</span></label>
                      <label class="peq-type-option"><input type="radio" name="peqType" id="peqTypeLSQ" value="LSQ"><span class="peq-type-btn">LSQ</span></label>
                      <label class="peq-type-option"><input type="radio" name="peqType" id="peqTypeHSQ" value="HSQ"><span class="peq-type-btn">HSQ</span></label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="peq-overlay-footer">
              <button id="applyPEQOverlay" class="peq-btn primary">Apply</button>
              <button id="cancelPEQOverlay" class="peq-btn">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const anchorElement = document.querySelector(anchorDiv);

    if (anchorElement) {
      anchorElement.insertAdjacentHTML(placement, visualizePEQHTML);
      console.log('VisualizePEQ UI added ' + placement + ' to anchor element');
    } else {
      console.error('Anchor element "' + anchorDiv + '" not found in the DOM.');
    }

    document.body.appendChild(document.getElementById('peqOverlayBackdrop'));
  }

  function initializeVisualizePEQ() {
    // State shared within overlay
    let freqData = [], splData = [], phaseData = [];
    let targetFreqData = [], targetSplData = [];
    let alignmentFreq = null;
    let filters = [];
    let selectedFilter = null;
    let isEditing = false;
    let editSnapshot = null;
    let overlayOpen = false;
    const fs = 48000;

    // Titles for desktop vs mobile
    const LONG_TITLE = "PEQ Visualizer: Click on 'Dot' on chart to change, press 'Q' or 'W' to alter qValues, 'T' to toggle filter type";
    const SHORT_TITLE = "PEQ Visualizer: Click on 'Dot' on chart to change?";

    function applyTitleForViewport() {
      const titleEl = document.getElementById('peqOverlayTitle');
      if (!titleEl) return;
      const isNarrow = window.innerWidth <= 768; // treat as mobile/tablet portrait
      titleEl.textContent = isNarrow ? SHORT_TITLE : LONG_TITLE;
    }

    // Limits for gain and Q values (can be overridden via openOverlay)
    let maxGain = 12;
    let minGain = -12;
    let minQ = 0.2;
    let maxQ = 10;

    // Plotly layout/config
    const layout = {
      xaxis: { type: 'log', title: 'Frequency (Hz)', range: [1, 4.3], showgrid: true },
      yaxis: { title: 'SPL (dB)', showgrid: true },
      paper_bgcolor: '#111',
      plot_bgcolor: '#111',
      font: { color: '#ddd' },
      dragmode: false,
      margin: { l: 50, r: 20, t: 20, b: 50 },
      autosize: false,
      width: null
    };

    const config = {
      responsive: true,
      staticPlot: true,
      scrollZoom: false,
      doubleClick: false,
      displayModeBar: false,
      displaylogo: false
    };

    function dbToMag(db) { return Math.pow(10, db / 20); }
    function magToDb(mag) { return 20 * Math.log10(mag); }

    // Upper limit for source/target FR data to avoid high-frequency outliers stretching the scale
    const MAX_FR_FREQ = 14000; // Hz

    // Use FR data from passed phoneObj parameter
    function ensureFRFromPhone(phoneObjParam) {
      try {
        const ph = phoneObjParam || null;
        if (ph && ph.rawChannels && Array.isArray(ph.rawChannels) && ph.rawChannels.length > 0) {
          // Use rawChannels format: array of channels, each channel is array of [freq, spl] pairs
          // Use first channel (index 0)
          let channel = ph.rawChannels[0];
          // Truncate any measurements beyond MAX_FR_FREQ to prevent y-axis stretching due to outliers
          if (Array.isArray(channel)) {
            const filtered = channel.filter(point => Array.isArray(point) && point.length >= 2 && Number(point[0]) <= MAX_FR_FREQ);
            // If filtering removed everything (edge case), keep original to avoid empty data
            if (filtered.length > 0) channel = filtered;
          }
          if (Array.isArray(channel) && channel.length > 0) {
            freqData = channel.map(point => point[0]);  // frequency is first element
            splData = channel.map(point => point[1]);   // spl is second element
            phaseData = channel.map(() => 0);           // phase not available in this format
          } else {
            // Fallback if channel structure is unexpected
            throw new Error('Invalid channel structure');
          }
        } else {
          // default flat FR if no data available
          const points = 256;
          const fMin = 20, fMax = MAX_FR_FREQ;
          const logMin = Math.log10(fMin), logMax = Math.log10(fMax);
          freqData = []; splData = []; phaseData = [];
          for (let i = 0; i < points; i++) {
            const t = i / (points - 1);
            const f = Math.pow(10, logMin + t * (logMax - logMin));
            freqData.push(f);
            splData.push(0);
            phaseData.push(0);
          }
        }
      } catch(_) {
        // fallback flat FR on error
        const points = 256;
        const fMin = 20, fMax = MAX_FR_FREQ;
        const logMin = Math.log10(fMin), logMax = Math.log10(fMax);
        freqData = []; splData = []; phaseData = [];
        for (let i = 0; i < points; i++) {
          const t = i / (points - 1);
          const f = Math.pow(10, logMin + t * (logMax - logMin));
          freqData.push(f);
          splData.push(0);
          phaseData.push(0);
        }
      }
    }

    function biquadPeakingEQ(f, gainDb, Q, freqs) {
      const A = Math.pow(10, gainDb / 40);
      const w0 = 2 * Math.PI * f / fs;
      const alpha = Math.sin(w0) / (2 * Q);
      let b0 = 1 + alpha * A;
      let b1 = -2 * Math.cos(w0);
      let b2 = 1 - alpha * A;
      let a0 = 1 + alpha / A;
      let a1 = -2 * Math.cos(w0);
      let a2 = 1 - alpha / A;
      b0 /= a0; b1 /= a0; b2 /= a0;
      a1 /= a0; a2 /= a0; a0 = 1;

      return freqs.map(freq => {
        const w = 2 * Math.PI * freq / fs;
        const cosw = Math.cos(w);
        const sinw = Math.sin(w);
        const cos2w = Math.cos(2*w);
        const sin2w = Math.sin(2*w);
        const numRe = b0 + b1 * cosw + b2 * cos2w;
        const numIm = - (b1 * sinw + b2 * sin2w);
        const denRe = 1 + a1 * cosw + a2 * cos2w;
        const denIm = - (a1 * sinw + a2 * sin2w);
        const numMag2 = numRe*numRe + numIm*numIm;
        const denMag2 = denRe*denRe + denIm*denIm;
        return Math.sqrt(numMag2 / denMag2);
      });
    }

    function biquadLowShelf(f, gainDb, Q, freqs) {
      const A = Math.pow(10, gainDb / 40);
      const w0 = 2 * Math.PI * f / fs;
      const alpha = Math.sin(w0) / (2 * Q);
      const cosw0 = Math.cos(w0);
      const sqrtA = Math.sqrt(A);

      let b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sqrtA * alpha);
      let b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
      let b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sqrtA * alpha);
      let a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqrtA * alpha;
      let a1 = -2 * ((A - 1) + (A + 1) * cosw0);
      let a2 = (A + 1) + (A - 1) * cosw0 - 2 * sqrtA * alpha;

      b0 /= a0; b1 /= a0; b2 /= a0;
      a1 /= a0; a2 /= a0; a0 = 1;

      return freqs.map(freq => {
        const w = 2 * Math.PI * freq / fs;
        const cosw = Math.cos(w);
        const sinw = Math.sin(w);
        const cos2w = Math.cos(2*w);
        const sin2w = Math.sin(2*w);
        const numRe = b0 + b1 * cosw + b2 * cos2w;
        const numIm = - (b1 * sinw + b2 * sin2w);
        const denRe = 1 + a1 * cosw + a2 * cos2w;
        const denIm = - (a1 * sinw + a2 * sin2w);
        const numMag2 = numRe*numRe + numIm*numIm;
        const denMag2 = denRe*denRe + denIm*denIm;
        return Math.sqrt(numMag2 / denMag2);
      });
    }

    function biquadHighShelf(f, gainDb, Q, freqs) {
      const A = Math.pow(10, gainDb / 40);
      const w0 = 2 * Math.PI * f / fs;
      const alpha = Math.sin(w0) / (2 * Q);
      const cosw0 = Math.cos(w0);
      const sqrtA = Math.sqrt(A);

      let b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sqrtA * alpha);
      let b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      let b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sqrtA * alpha);
      let a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqrtA * alpha;
      let a1 = 2 * ((A - 1) - (A + 1) * cosw0);
      let a2 = (A + 1) - (A - 1) * cosw0 - 2 * sqrtA * alpha;

      b0 /= a0; b1 /= a0; b2 /= a0;
      a1 /= a0; a2 /= a0; a0 = 1;

      return freqs.map(freq => {
        const w = 2 * Math.PI * freq / fs;
        const cosw = Math.cos(w);
        const sinw = Math.sin(w);
        const cos2w = Math.cos(2*w);
        const sin2w = Math.sin(2*w);
        const numRe = b0 + b1 * cosw + b2 * cos2w;
        const numIm = - (b1 * sinw + b2 * sin2w);
        const denRe = 1 + a1 * cosw + a2 * cos2w;
        const denIm = - (a1 * sinw + a2 * sin2w);
        const numMag2 = numRe*numRe + numIm*numIm;
        const denMag2 = denRe*denRe + denIm*denIm;
        return Math.sqrt(numMag2 / denMag2);
      });
    }

    function applyFilter(filt, freqs) {
      const type = filt.type || 'PK';
      if (type === 'LSQ') {
        return biquadLowShelf(filt.freq, filt.gain, filt.Q, freqs);
      } else if (type === 'HSQ') {
        return biquadHighShelf(filt.freq, filt.gain, filt.Q, freqs);
      } else {
        return biquadPeakingEQ(filt.freq, filt.gain, filt.Q, freqs);
      }
    }

    function computeEQResponse() {
      if (freqData.length === 0) return [];
      let eqMag = freqData.map(() => 1);
      filters.forEach(filt => {
        const filtMag = applyFilter(filt, freqData);
        eqMag = eqMag.map((m, i) => m * filtMag[i]);
      });
      const eqDb = eqMag.map(m => magToDb(m));
      return splData.map((v, i) => v + eqDb[i]);
    }

    function interpXY(xArr, yArr, x) {
      if (!xArr || xArr.length === 0) return 0;
      if (x <= xArr[0]) return yArr[0];
      if (x >= xArr[xArr.length - 1]) return yArr[yArr.length - 1];
      let lo = 0, hi = xArr.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xArr[mid] <= x) lo = mid; else hi = mid;
      }
      const t = (x - xArr[lo]) / (xArr[hi] - xArr[lo]);
      return yArr[lo] * (1 - t) + yArr[hi] * t;
    }

    function rawFRAt(freq) {
      return interpXY(freqData, splData, freq);
    }

    function filterMagArray(filt, freqs) {
      return applyFilter(filt, freqs);
    }

    function filterDbArray(filt, freqs) {
      const mags = filterMagArray(filt, freqs);
      return mags.map(m => magToDb(m));
    }

    function filterDbAt(filt, f) {
      const m = applyFilter(filt, [f])[0];
      return magToDb(m);
    }

    function updateSliderRanges() {
      const gainSlider = document.getElementById('peqGainSlider');
      const qSlider = document.getElementById('peqQSlider');

      if (gainSlider) {
        gainSlider.min = minGain;
        gainSlider.max = maxGain;
      }
      if (qSlider) {
        qSlider.min = minQ;
        qSlider.max = maxQ;
      }
    }

    function updateInputs() {
      const slidersDiv = document.getElementById('peqSliders');
      const freqSlider = document.getElementById('peqFreqSlider');
      const gainSlider = document.getElementById('peqGainSlider');
      const qSlider = document.getElementById('peqQSlider');
      const freqVal = document.getElementById('peqFreqVal');
      const gainVal = document.getElementById('peqGainVal');
      const qVal = document.getElementById('peqQVal');
      const typeVal = document.getElementById('peqTypeVal');

      if (selectedFilter == null) {
        if (slidersDiv) slidersDiv.style.display = 'none';
        const typePanel = document.getElementById('peqTypePanel');
        if (typePanel) typePanel.style.display = 'none';
        if (freqVal) freqVal.textContent = '—';
        if (gainVal) gainVal.textContent = '—';
        if (qVal) qVal.textContent = '—';
        if (typeVal) typeVal.textContent = '—';
        // Clear radio selection
        const radios = document.querySelectorAll('input[name="peqType"]');
        radios.forEach(r => r.checked = false);
        return;
      }
      const filt = filters[selectedFilter];

      if (slidersDiv) slidersDiv.style.display = 'block';
      const typePanel = document.getElementById('peqTypePanel');
      if (typePanel) typePanel.style.display = 'block';
      if (freqSlider) freqSlider.value = freqToSlider(filt.freq).toFixed(2);
      if (gainSlider) gainSlider.value = filt.gain;
      if (qSlider) qSlider.value = filt.Q;
      if (freqVal) freqVal.textContent = `${Math.round(filt.freq)} Hz`;
      if (gainVal) gainVal.textContent = `${filt.gain.toFixed(2)} dB`;
      if (qVal) qVal.textContent = `${filt.Q.toFixed(2)}`;

      // Display filter type and sync radios
      const filterType = filt.type || 'PK';
      const filterLabel = filterType;
      if (typeVal) typeVal.textContent = filterLabel;
      const pk = document.getElementById('peqTypePK');
      const lsq = document.getElementById('peqTypeLSQ');
      const hsq = document.getElementById('peqTypeHSQ');
      if (pk && lsq && hsq) {
        pk.checked = filterType === 'PK';
        lsq.checked = filterType === 'LSQ';
        hsq.checked = filterType === 'HSQ';
      }
    }

    function plotFR() {
      if (freqData.length === 0) return;

      const eqData = computeEQResponse();

      // Compute yaxis range based on phone FR and target FR (prioritize these)
      const allY = [...splData];

      // Add target FR data if available
      if (targetSplData && targetSplData.length > 0) {
        // Apply alignment if specified
        if (alignmentFreq != null && alignmentFreq > 0) {
          const targetAtNorm = interpXY(targetFreqData, targetSplData, alignmentFreq);
          const rawAtNorm = rawFRAt(alignmentFreq);
          const offset = rawAtNorm - targetAtNorm;
          allY.push(...targetSplData.map(v => v + offset));
        } else {
          allY.push(...targetSplData);
        }
      }

      let yMin = Math.min(...allY);
      let yMax = Math.max(...allY);

      // If we have real FR data (phone or target), use 10% padding around their range
      const hasRealData = splData.some(v => Math.abs(v) > 0.001) || (targetSplData && targetSplData.length > 0);
      const dataRange = yMax - yMin;

      if (!hasRealData || dataRange < 1) {
        // No real data - use filter gain limits with padding
        yMin = minGain - 2;
        yMax = maxGain + 2;
      } else {
        // Add 10% padding above and below the phone/target FR range
        const padding = dataRange * 0.1;
        yMin = yMin - padding;
        yMax = yMax + padding;
      }

      const yRange = yMax - yMin;
      const topThreshold = yMax - yRange * 0.15; // If point is in top 15%, put text below

      // Check if mobile screen size (portrait orientation) - hide text labels to reduce clutter
      const isMobile = window.innerWidth < window.innerHeight;

      const handleTraces = filters.map((filt, idx) => {
        const yVal = rawFRAt(filt.freq) + filt.gain;
        const textPos = (yVal > topThreshold) ? 'bottom center' : 'top center';
        const isSelected = (idx === selectedFilter);
        const filterType = filt.type || 'PK';
        const filterLabel = filterType === 'LSQ' ? 'LS' : (filterType === 'HSQ' ? 'HS' : 'PEQ');

        return {
          x: [filt.freq],
          y: [yVal],
          mode: isMobile ? 'markers' : 'markers+text',
          marker: { size: (isSelected ? (isEditing ? 18 : 16) : 12), color: isSelected ? (isEditing ? '#ffd34d' : '#ffcc00') : '#ff6600' },
          text: isSelected ? [`${filterLabel} ${idx+1}<br>F=${filt.freq.toFixed(1)}Hz<br>G=${filt.gain.toFixed(1)}dB<br>Q=${filt.Q.toFixed(2)}`] : [`${filterLabel} ${idx+1}`],
          textposition: textPos,
          name: `${filterLabel} ${idx+1}`
        };
      });

      const traces = [
        { x: freqData, y: splData, mode: 'lines', name: 'Raw FR', line: { color: '#666' } }
      ];

      // Add Target FR trace if available
      if (targetFreqData.length && targetSplData.length) {
        let targetSpl = targetSplData.slice();

        // Apply alignment/normalization if specified
        if (alignmentFreq != null && alignmentFreq > 0) {
          const targetAtNorm = interpXY(targetFreqData, targetSplData, alignmentFreq);
          const rawAtNorm = rawFRAt(alignmentFreq);
          const offset = rawAtNorm - targetAtNorm;
          targetSpl = targetSpl.map(v => v + offset);
        }

        traces.push({
          x: targetFreqData,
          y: targetSpl,
          mode: 'lines',
          name: 'Target FR',
          line: { color: '#00ff88', width: 2, dash: 'dash' }
        });
      }

      traces.push(
        { x: freqData, y: eqData, mode: 'lines', name: 'EQ Applied', line: { color: '#00ccff', width: 3 } },
        ...handleTraces
      );

      if (selectedFilter != null && filters[selectedFilter]) {
        const filt = filters[selectedFilter];
        const filtDb = filterDbArray(filt, freqData);
        const curve = filtDb.map((d, i) => d + splData[i]);
        traces.push({
          x: freqData,
          y: curve,
          mode: 'lines',
          name: 'Selected Filter',
          line: { color: '#ffaa00', width: 2, dash: 'dot' },
          opacity: (isEditing ? 1.0 : 0.6)
        });
      }

      // Get the chart container dimensions
      const chartContainer = document.getElementById('peqChart');
      const containerWidth = chartContainer.offsetWidth;
      const containerHeight = chartContainer.offsetHeight;

      // Set Y-axis range dynamically
      const updatedLayout = {
        ...layout,
        width: containerWidth,
        height: containerHeight,
        yaxis: {
          ...layout.yaxis,
          range: [yMin, yMax]
        }
      };

      Plotly.react('peqChart', traces, updatedLayout, config);
      updateInputs();
    }

    // Overlay wiring and utilities
    const backdrop = document.getElementById('peqOverlayBackdrop');
    const btnOpen = document.getElementById('openPEQOverlay');
    const btnCancel = document.getElementById('cancelPEQOverlay');
    const btnApply = document.getElementById('applyPEQOverlay');

    function ensurePlotly() {
      return new Promise((resolve) => {
        if (window.Plotly) return resolve();
        const s = document.createElement('script');
        s.src = 'https://cdn.plot.ly/plotly-3.2.0.min.js';
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    }

    /**
     * Opens the PEQ overlay with optional phone, target, and alignment frequency parameters
     *
     */
    function openOverlay() {
      // If no params provided, try to get from context method
      if (!phoneObjParam && context && typeof context.getCurrentPhoneTargetNormalisation === 'function') {
        var phoneObjParam, targetObjParam, alignmentFreqParam;
        try {
          const data = context.getCurrentPhoneTargetNormalisation();
          phoneObjParam = data.phoneObj;
          targetObjParam = data.targetObj;
          alignmentFreqParam = data.norm_fr;
        } catch (e) {
          console.warn('getCurrentPhoneTargetNormalisation failed:', e);
          return;
        }
      }

      // Set up phone/raw FR data
      ensureFRFromPhone(phoneObjParam);

      // Set up target FR data if provided
      if (targetObjParam && targetObjParam.rawChannels && Array.isArray(targetObjParam.rawChannels) && targetObjParam.rawChannels.length > 0) {
        // Use rawChannels format: array of channels, each channel is array of [freq, spl] pairs
        // Use first channel (index 0)
        let targetChannel = targetObjParam.rawChannels[0];
        // Truncate any target measurements beyond MAX_FR_FREQ
        if (Array.isArray(targetChannel)) {
          const filteredT = targetChannel.filter(point => Array.isArray(point) && point.length >= 2 && Number(point[0]) <= MAX_FR_FREQ);
          if (filteredT.length > 0) targetChannel = filteredT;
        }
        if (Array.isArray(targetChannel) && targetChannel.length > 0) {
          targetFreqData = targetChannel.map(point => point[0]);  // frequency is first element
          targetSplData = targetChannel.map(point => point[1]);   // spl is second element
        } else {
          targetFreqData = [];
          targetSplData = [];
        }
      } else {
        targetFreqData = [];
        targetSplData = [];
      }

      // Set alignment frequency if provided (or fall back to context if available)
      if (alignmentFreqParam != null) {
        alignmentFreq = alignmentFreqParam;
      } else {
        const ph = (context && context.phoneObj) ? context.phoneObj : null;
        alignmentFreq = (ph && ph.normalizeFRFreq) || null;
      }


      // Reset to defaults
      maxGain = 12;
      minGain = -12;
      minQ = 0.2;
      maxQ = 10;

      // Pull filters from index.html elements via context
      try {
        const src = (context && typeof context.elemToFilters === 'function') ? context.elemToFilters(true) : [];
        filters = (src || []).filter(f => !f.disabled).map(f => ({
          type: f.type || 'PK',
          freq: Number(f.freq) || 1000,
          gain: Number(f.gain) || 0,
          Q: Number(f.q != null ? f.q : f.Q) || 1
        }));
      } catch(e) {
        console.warn('elemToFilters failed:', e);
        filters = [];
      }
      selectedFilter = filters.length ? 0 : null;
      overlayOpen = true;
      if (backdrop) backdrop.style.display = 'flex';
      updateSliderRanges(); // Update slider/input ranges based on limits
      applyTitleForViewport();
      ensurePlotly().then(() => {
        plotFR();
        updateInputs();
      });
    }

    function closeOverlay() {
      overlayOpen = false;
      if (backdrop) backdrop.style.display = 'none';
    }

    // Keep button click for backward compatibility
    if (btnOpen) btnOpen.addEventListener('click', () => { openOverlay(); });

    if (btnCancel) btnCancel.addEventListener('click', () => {
      // Discard local changes by re-pulling on next open
      closeOverlay();
    });

    if (btnApply) btnApply.addEventListener('click', () => {
      try {
        const out = filters.map(f => ({
          type: f.type || 'PK',
          freq: Math.floor(f.freq), // Round down frequency to whole number
          gain: Math.round(f.gain * 10) / 10, // Round gain to 1 decimal place
          q: Math.round(f.Q * 10) / 10, // Round Q to 1 decimal place
          disabled: false
        }));
        if (context && typeof context.filtersToElem === 'function') {
          context.filtersToElem(out);
          // Apply the EQ changes if applyEQ is available
          if (context && typeof context.applyEQ === 'function') {
            context.applyEQ();
          }
          // Notify other components
          try { document.dispatchEvent(new CustomEvent('UpdateExtensionFilters')); } catch(_) {}
        }
      } catch(e) {
        console.error('filtersToElem failed:', e);
      }
      closeOverlay();
    });

    // Refresh FR if loaded after opening (for backward compatibility)
    document.addEventListener('PhoneFRLoaded', () => {
      if (!overlayOpen) return;
      ensureFRFromPhone();
      plotFR();
    });

    // Refresh when target FR is loaded (for backward compatibility)
    document.addEventListener('TargetFRLoaded', () => {
      if (!overlayOpen) return;
      plotFR();
    });

    // Refresh when normalize FR frequency changes (for backward compatibility)
    document.addEventListener('NormalizeFRChanged', () => {
      if (!overlayOpen) return;
      plotFR();
    });

    // Optional: refresh from external filter changes if not editing
    document.addEventListener('UpdateExtensionFilters', () => {
      if (!overlayOpen || isEditing) return;
      try {
        const src = (context && typeof context.elemToFilters === 'function') ? context.elemToFilters(true) : [];
        filters = (src || []).filter(f => !f.disabled).map(f => ({
          type: f.type || 'PK',
          freq: Number(f.freq) || 100,
          gain: Number(f.gain) || 0,
          Q: Number(f.q != null ? f.q : f.Q) || 1
        }));
        if (selectedFilter != null && selectedFilter >= filters.length) selectedFilter = filters.length ? 0 : null;
        plotFR();
      } catch(_) {}
    });


    // Sliders
    const slidersDiv = document.getElementById('peqSliders');
    const freqSlider = document.getElementById('peqFreqSlider');
    const gainSlider = document.getElementById('peqGainSlider');
    const qSlider = document.getElementById('peqQSlider');
    const freqVal = document.getElementById('peqFreqVal');
    const gainVal = document.getElementById('peqGainVal');
    const qVal = document.getElementById('peqQVal');

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function clampFreq(f) { return clamp(f, 20, 20000); }
    function roundToStep(value, step) { return Math.round(value / step) * step; }
    const LOG_FMIN = Math.log10(20);
    const LOG_FMAX = Math.log10(20000);
    function freqToSlider(f) {
      const lf = Math.log10(clampFreq(f));
      return ((lf - LOG_FMIN) / (LOG_FMAX - LOG_FMIN)) * 100;
    }
    function sliderToFreq(s) {
      const t = clamp(Number(s), 0, 100) / 100;
      const lf = LOG_FMIN + t * (LOG_FMAX - LOG_FMIN);
      return Math.pow(10, lf);
    }

    if (freqSlider) freqSlider.addEventListener('input', () => {
      if (selectedFilter == null) return;
      const freq = clampFreq(sliderToFreq(freqSlider.value));
      if (!isEditing) beginEdit();
      filters[selectedFilter].freq = freq;
      if (freqVal) freqVal.textContent = `${Math.round(freq)} Hz`;
      plotFR();
    });
    if (gainSlider) gainSlider.addEventListener('input', () => {
      if (selectedFilter == null) return;
      const gain = clamp(Number(gainSlider.value || 0), minGain, maxGain);
      if (!isEditing) beginEdit();
      filters[selectedFilter].gain = gain;
      if (gainVal) gainVal.textContent = `${gain.toFixed(2)} dB`;
      plotFR();
    });
    if (qSlider) qSlider.addEventListener('input', () => {
      if (selectedFilter == null) return;
      const q = clamp(Number(qSlider.value || 0), minQ, maxQ);
      if (!isEditing) beginEdit();
      filters[selectedFilter].Q = q;
      if (qVal) qVal.textContent = `${q.toFixed(2)}`;
      plotFR();
    });

    // Radio buttons for filter type
    const pkRadio = document.getElementById('peqTypePK');
    const lsqRadio = document.getElementById('peqTypeLSQ');
    const hsqRadio = document.getElementById('peqTypeHSQ');
    function onTypeChange(ev) {
      if (!ev || !ev.target) return;
      if (selectedFilter == null) return;
      const val = ev.target.value;
      if (val !== 'PK' && val !== 'LSQ' && val !== 'HSQ') return;
      if (!isEditing) beginEdit();
      filters[selectedFilter].type = val;
      plotFR();
    }
    if (pkRadio) pkRadio.addEventListener('change', onTypeChange);
    if (lsqRadio) lsqRadio.addEventListener('change', onTypeChange);
    if (hsqRadio) hsqRadio.addEventListener('change', onTypeChange);

    // Interaction handling
    let dragging = false;
    let dragTarget = null;

    const chart = document.getElementById('peqChart');

    function deepCopyFilters(src) { return JSON.parse(JSON.stringify(src)); }

    function beginEdit() {
      if (isEditing) return;
      editSnapshot = deepCopyFilters(filters);
      isEditing = true;
      Plotly.relayout(chart, { dragmode: false });
      plotFR();
    }

    function commitEdit() {
      if (!isEditing) return;
      isEditing = false;
      editSnapshot = null;
      Plotly.relayout(chart, { dragmode: 'pan' });
      plotFR();
    }

    function cancelEdit() {
      if (!isEditing) return;
      if (editSnapshot) filters = deepCopyFilters(editSnapshot);
      isEditing = false;
      editSnapshot = null;
      Plotly.relayout(chart, { dragmode: 'pan' });
      plotFR();
    }

    function eventToData(ev) {
      const gd = chart;
      const xa = gd._fullLayout.xaxis;
      const ya = gd._fullLayout.yaxis;
      const rect = gd.getBoundingClientRect();
      // Support both mouse and touch events
      const clientX = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
      const clientY = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0);
      const px = clientX - rect.left - xa._offset;
      const py = clientY - rect.top - ya._offset;
      const xVal = Math.pow(10, xa.p2l(px));
      const yVal = ya.p2l(py);
      return { xVal, yVal, xa, ya, px, py };
    }

    function getHandlePixelPositions(filt, xa, ya) {
      const cx = xa.l2p(Math.log10(filt.freq));
      const cy = ya.l2p(rawFRAt(filt.freq) + filt.gain);
      return { center: {x: cx, y: cy} };
    }

    function nearestAnyHandle(px, py, xa, ya) {
      let best = { type: null, filterIdx: null, dist2: Infinity };
      for (let i = 0; i < filters.length; i++) {
        const pos = getHandlePixelPositions(filters[i], xa, ya);
        const type = 'center';
        const hx = pos[type].x;
        const hy = pos[type].y;
        const dx = px - hx;
        const dy = py - hy;
        const d2 = dx*dx + dy*dy;
        if (d2 < best.dist2) best = { type, filterIdx: i, dist2: d2 };
      }
      const thresholdPx = 20;
      return (Math.sqrt(best.dist2) <= thresholdPx) ? best : { type: null, filterIdx: null, dist2: best.dist2 };
    }

    chart.addEventListener('mousedown', (ev) => {
      if (filters.length === 0) return;
      const { xa, ya, px, py } = eventToData(ev);
      const hit = nearestAnyHandle(px, py, xa, ya);
      if (hit.type) {
        const wasSelected = (selectedFilter === hit.filterIdx);
        if (isEditing && !wasSelected) {
          commitEdit();
        }
        selectedFilter = hit.filterIdx;
        if (!wasSelected) {
          dragTarget = null;
          dragging = false;
          plotFR();
          return;
        }
        dragTarget = hit.type;
        beginEdit();
        dragging = true;
        plotFR();
        ev.preventDefault();
        ev.stopPropagation();
      } else {
        if (isEditing) {
          commitEdit();
          ev.preventDefault();
          ev.stopPropagation();
        }
      }
    });

    chart.addEventListener('mousemove', (ev) => {
      if (!dragging || selectedFilter === null) return;
      const { xVal, yVal } = eventToData(ev);
      const filt = filters[selectedFilter];

      filt.freq = Math.max(20, Math.min(20000, xVal));
      const base = rawFRAt(filt.freq);
      const rawGain = yVal - base;
      // Round gain to 0.1dB increments to avoid tiny meaningless changes
      filt.gain = roundToStep(Math.max(minGain, Math.min(maxGain, rawGain)), 0.1);

      plotFR();
      ev.preventDefault();
      ev.stopPropagation();
    });

    function endDrag() {
      if (dragging) {
        dragging = false;
        dragTarget = null;
        Plotly.relayout(chart, { dragmode: isEditing ? false : 'pan' });
      }
    }

    chart.addEventListener('mouseup', endDrag);
    chart.addEventListener('mouseleave', endDrag);

    // Touch event support for mobile
    chart.addEventListener('touchstart', (ev) => {
      if (filters.length === 0) return;
      const { xa, ya, px, py } = eventToData(ev);
      const hit = nearestAnyHandle(px, py, xa, ya);
      if (hit.type) {
        const wasSelected = (selectedFilter === hit.filterIdx);
        if (isEditing && !wasSelected) {
          commitEdit();
        }
        selectedFilter = hit.filterIdx;
        if (!wasSelected) {
          dragTarget = null;
          dragging = false;
          plotFR();
          return;
        }
        dragTarget = hit.type;
        beginEdit();
        dragging = true;
        plotFR();
        ev.preventDefault();
        ev.stopPropagation();
      } else {
        if (isEditing) {
          commitEdit();
          ev.preventDefault();
          ev.stopPropagation();
        }
      }
    }, { passive: false });

    chart.addEventListener('touchmove', (ev) => {
      if (!dragging || selectedFilter === null) return;
      const { xVal, yVal } = eventToData(ev);
      const filt = filters[selectedFilter];

      filt.freq = Math.max(20, Math.min(20000, xVal));
      const base = rawFRAt(filt.freq);
      const rawGain = yVal - base;
      // Round gain to 0.1dB increments to avoid tiny meaningless changes
      filt.gain = roundToStep(Math.max(minGain, Math.min(maxGain, rawGain)), 0.1);

      plotFR();
      ev.preventDefault();
      ev.stopPropagation();
    }, { passive: false });

    chart.addEventListener('touchend', endDrag, { passive: false });
    chart.addEventListener('touchcancel', endDrag, { passive: false });

    chart.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    }, { passive: false });

    // Keyboard handling: Enter to commit (Esc does nothing)
    document.addEventListener('keydown', (ev) => {
      if (!isEditing) return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commitEdit();
      }
    });

    // Keyboard shortcuts for F/G/Q and W/Q width control
    document.addEventListener('keydown', (ev) => {
      const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      if (selectedFilter == null) return;

      const filt = filters[selectedFilter];
      let changed = false;

      const shift = ev.shiftKey;
      const alt = ev.altKey;

      const freqStep = alt ? 1.002 : (shift ? 1.05 : 1.01);
      const gainStep = alt ? 0.05 : (shift ? 1.0 : 0.2);
      const qStepInc = alt ? 1.03 : (shift ? 1.3 : 1.1); // increase Q → narrower
      const qStepDec = 1 / qStepInc; // decrease Q → wider

      if (ev.key === 'd' || ev.key === 'D') {
        filt.freq = Math.max(20, Math.min(20000, filt.freq / freqStep));
        changed = true;
      } else if (ev.key === 'f' || ev.key === 'F') {
        filt.freq = Math.max(20, Math.min(20000, filt.freq * freqStep));
        changed = true;
      }
      else if (ev.key === 'r' || ev.key === 'R') {
        filt.gain = Math.max(minGain, Math.min(maxGain, filt.gain + gainStep));
        changed = true;
      } else if (ev.key === 'c' || ev.key === 'C') {
        filt.gain = Math.max(minGain, Math.min(maxGain, filt.gain - gainStep));
        changed = true;
      }
      else if (ev.key === 's' || ev.key === 'S' || ev.key === 'w' || ev.key === 'W') {
        // S or W → wider (decrease Q)
        filt.Q = Math.max(minQ, Math.min(maxQ, filt.Q * qStepDec));
        changed = true;
      } else if (ev.key === 'g' || ev.key === 'G' || ev.key === 'q' || ev.key === 'Q') {
        // G or Q → narrower (increase Q)
        filt.Q = Math.max(minQ, Math.min(maxQ, filt.Q * qStepInc));
        changed = true;
      }
      else if (ev.key === 't' || ev.key === 'T') {
        // T → toggle filter type: PK → LSQ → HSQ → PK
        const currentType = filt.type || 'PK';
        if (currentType === 'PK') {
          filt.type = 'LSQ';
        } else if (currentType === 'LSQ') {
          filt.type = 'HSQ';
        } else {
          filt.type = 'PK';
        }
        changed = true;
      }

      if (changed) {
        if (!isEditing) beginEdit();
        plotFR();
        ev.preventDefault();
        ev.stopPropagation();
      }
    });

    // Handle window resize to replot chart with correct dimensions
    let resizeTimeout = null;
    window.addEventListener('resize', () => {
      if (!overlayOpen) return;
      // Debounce resize events to avoid excessive replotting
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        applyTitleForViewport();
        plotFR();
      }, 150);
    });
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        loadHtml();
        initializeVisualizePEQ();
      });
    } else {
      loadHtml();
      initializeVisualizePEQ();
    }
  } catch (error) {
    console.error("Error initializing VisualizePEQ Plugin:", error.message);
  }
}

// Export for CommonJS & ES Modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = initializeVisualizePEQPlugin;
}

// Export for ES Modules
export default initializeVisualizePEQPlugin;
