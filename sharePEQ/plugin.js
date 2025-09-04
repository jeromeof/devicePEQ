// Copyright 2025 : Pragmatic Audio
// PEQ URL Generator Plugin
// This extraEQ plugin reads current PEQ filters from the graphtool context
// and generates a shareable URL with an encoded PEQ parameter.

function encodeFiltersToParam(filters, options = {}) {
    // New scheme: individual URL parameters per filter
    // For filter i (1-based): Fi (frequency), Ti (type), Gi (gain), Qi (Q), Di present => disabled; if Di absent => enabled
    // This function now returns a URLSearchParams instance prefilled with those keys.
    const params = new URLSearchParams();
    const preamp = options.preamp;
    // Keep preamp compatibility: if provided, include as P (uppercase) for clarity
    if (preamp !== undefined && preamp !== null) {
        params.set('P', String(Number(preamp) || 0));
    }
    // Include the selected phone if available
    const selectedPhone = options.selectedPhone;
    if (selectedPhone) {
        params.set('selphone', selectedPhone);
    }
    (filters || []).forEach((f, idx) => {
        const i = idx + 1;
        const T = f.type || 'PK';
        const F = Number(f.freq) || 0;
        const Q = Number(f.q) || 0;
        const G = Number(f.gain) || 0;
        const D = !!f.disabled;
        params.set(`T${i}`, T);
        params.set(`F${i}`, String(F));
        params.set(`Q${i}`, String(Q));
        params.set(`G${i}`, String(G));
        if (D) params.set(`D${i}`, '1'); // presence indicates disabled
    });
    return params;
}

function buildUrlWithParam(paramsToApply) {
    // Build a new URL that preserves existing raw query encoding (e.g., commas in `share`)
    // while replacing only PEQ-related params (F*/T*/G*/Q*/D*/P) and selphone.
    const href = window.location.href;
    const [base, hash = ''] = href.split('#');
    const [path, query = ''] = base.split('?');

    // Keep raw tokens to avoid re-encoding existing params like `share`
    const tokens = query ? query.split('&').filter(Boolean) : [];
    const kept = tokens.filter(t => {
        const eq = t.indexOf('=');
        const rawKey = eq >= 0 ? t.slice(0, eq) : t;
        // Decode key for matching only; keep raw token for output
        let key;
        try { key = decodeURIComponent(rawKey); } catch(_) { key = rawKey; }
        return !(/^([FTGQD]\d+|P|selphone)$/.test(key));
    });

    // Append new PEQ params (safe to encode these fresh keys/values)
    const additions = [];
    paramsToApply.forEach((v, k) => {
        additions.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });

    const qs = [...kept, ...additions].join('&');
    const newUrl = qs ? (path + '?' + qs) : path;
    return hash ? (newUrl + '#' + hash) : newUrl;
}

async function initializePeqUrlPlugin(context) {
    function decodeFiltersFromUrl() {
        try {
            const url = new URL(window.location.href);
            const sp = url.searchParams;
            // Collect indices present by scanning F/T/G/Q/D
            let max = 0;
            for (const k of sp.keys()) {
                const m = /^([FTGQD])(\d+)$/.exec(k);
                if (m) max = Math.max(max, parseInt(m[2], 10) || 0);
            }
            if (max === 0) return null;
            const filters = [];
            for (let i = 1; i <= max; i++) {
                const type = sp.get(`T${i}`) || 'PK';
                const freq = parseFloat(sp.get(`F${i}`) || '0');
                const gain = parseFloat(sp.get(`G${i}`) || '0');
                const q = parseFloat(sp.get(`Q${i}`) || '0');
                const disabled = sp.has(`D${i}`);
                // If all values are missing and not disabled and not type-provided, skip empty trailing holes
                const hasAny = sp.has(`T${i}`) || sp.has(`F${i}`) || sp.has(`G${i}`) || sp.has(`Q${i}`) || sp.has(`D${i}`);
                if (!hasAny) {
                    // Keep position with defaults to preserve index alignment
                }
                filters.push({ type, freq, gain, q, disabled });
            }
            const preamp = sp.has('P') ? parseFloat(sp.get('P') || '0') : undefined;
            const selectedPhone = sp.has('selphone') ? sp.get('selphone').replace(/_/g, ' ') : undefined;
            return { filters, preamp, selectedPhone };
        } catch (e) {
            return null;
        }
    }
    // Create minimal UI under the extra EQ section
    function injectUI() {
        const container = document.createElement('div');
        container.id = 'peqUrlPlugin';
        container.style.marginBottom = '12px';

        // Set default values for configuration
        var headingTag = 'h4';
        var placement = 'afterend';
        var anchorDiv = '.extra-eq';
        
        // Override with context config values if available
        if (context && context.config) {
            if (context.config.sharePEQHeadingTag) {
                headingTag = context.config.sharePEQHeadingTag;
            }
            if (context.config.sharePEQPlacement) {
                placement = context.config.sharePEQPlacement;
            }
            if (context.config.sharePEQAnchorDiv) {
                anchorDiv = context.config.sharePEQAnchorDiv;
            }
        }
        
        container.innerHTML = `
      <style>
        #peqUrlPlugin .peq-url-row { display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; }
        #peqUrlPlugin input[type="text"] { flex: 1 1 auto; min-width: 160px; padding: 6px 8px; cursor: pointer; }
        #peqUrlPlugin .hint { font-size: 12px; opacity: 0.8; margin-top: 6px; }
        #peqUrlPlugin .share-btn { border: 1px solid var(--c-card-border, #ddd); border-radius: 6px; background: var(--c-card-bg, #f8f8f8); cursor: pointer; padding: 6px; display: inline-flex; align-items: center; justify-content: center; }
        #peqUrlPlugin .share-btn svg { width: 18px; height: 18px; display: block; }
        #peqUrlPlugin .share-btn:hover { filter: brightness(0.95); }
        #peqUrlPlugin .qr-inline { display: none; margin-top: 8px; text-align: center; }
      </style>
      <${headingTag} style="margin:0 0 6px 0;">Share your PEQ</${headingTag}>
      <div class="peq-url-row">
        <button id="share-native" class="share-btn" title="Share (system)" aria-label="Share (system)">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l4 4h-3v6h-2V7H8l4-4Zm-7 8h2v7h10v-7h2v9H5v-9Z"/></svg>
        </button>
        <input id="peq-url-output" type="text" readonly placeholder="URL appears after first change"/>
        <button id="toggle-qr" class="share-btn" title="Show QR Code" aria-label="Show QR Code">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm10 0h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v4h-6v-2h2v-2Zm-4-8h2v2h-2V9Z"/></svg>
        </button>
      </div>
      <div class="qr-inline" id="peq-qr-inline">
        <a id="peq-qr-link" href="#" target="_blank" rel="noopener" title="Open shared URL">
          <img id="peq-qr-img" alt="PEQ URL QR Code" style="width:256px;height:256px"/>
        </a>
        <div id="peq-qr-title" style="margin-top:8px;font-weight:600">
          <a id="peq-qr-title-link" href="#" target="_blank" rel="noopener"></a>
        </div>
        <div style="margin-top:6px"><a id="download-peq-qr" download="peq-qr.png">Download PNG</a></div>
        <div id="peq-qr-byline" class="hint" style="margin-top:6px">Brought to you by Pragmatic Audio</div>
      </div>
      <div class="hint">The URL and QR update automatically as you edit the PEQ. Click the URL to copy it.</div>
    `;
        // More flexible way to insert HTML into the DOM
        var placement = 'afterend';
        var anchorDiv = '.extra-eq';
        if (context && context.config ) {
            if (context.config.sharePEQPlacement) {
                placement = context.config.sharePEQPlacement;
            }
            if (context.config.sharePEQAnchorDiv) {
                anchorDiv = context.config.sharePEQAnchorDiv;
            }
        }

        const extraEq = document.querySelector(anchorDiv);
        if (!extraEq) {
            console.error('[PEQ URL] .extra-eq not found');
            return null;
        }

        extraEq.insertAdjacentElement(placement, container);
        return container;
    }

    const ui = injectUI();
    if (!ui) return;

    const nativeBtn = ui.querySelector('#share-native');
    const output = ui.querySelector('#peq-url-output');
    const toggleQrBtn = ui.querySelector('#toggle-qr');
    const qrInline = ui.querySelector('#peq-qr-inline');
    const qrImg = ui.querySelector('#peq-qr-img');
    const qrLink = ui.querySelector('#peq-qr-link');
    const qrDownload = ui.querySelector('#download-peq-qr');
    const qrTitleLink = ui.querySelector('#peq-qr-title-link');

    // Derive a friendly title from the selected EQ device, e.g., "FiiO FT1 EQ"
    function getPeqTitle() {
        try {
            const sel = document.querySelector('div.extra-eq select[name="phone"]');
            let base = sel && sel.value ? sel.value : '';
            // If no selection, try the first option after placeholder
            if (!base && sel && sel.options && sel.options.length > 1) {
                base = sel.options[1].value;
            }
            // Append " EQ" if not already present and if filters exist
            const hasFilters = (typeof context.elemToFilters === 'function') && (context.elemToFilters(true) || []).length > 0;
            let title = base || 'My PEQ';
            if (hasFilters && !/\sEQ$/.test(title)) title = `${title} EQ`;
            return title;
        } catch (_) {
            return 'My PEQ';
        }
    }

    function generate() {
        // Pull filters from context; true = include disabled and zeroed values in order
        const filters = (typeof context.elemToFilters === 'function') ? context.elemToFilters(true) : [];
        if (!filters || !filters.length) {
            output.value = '';
            return '';
        }

        // Get the selected phone
        const eqPhoneSelect = document.querySelector('div.extra-eq select[name="phone"]');
        const selectedPhone = eqPhoneSelect && eqPhoneSelect.value ? eqPhoneSelect.value.replace(/ /g, '_') : '';
        
        const preamp = (typeof context.calcEqDevPreamp === 'function') ? context.calcEqDevPreamp(filters) : 0;
        const params = encodeFiltersToParam(filters, { preamp, selectedPhone });
        const url = buildUrlWithParam(params);
        output.value = url;
        // Update browser address bar without reloading
        try { window.history.replaceState(null, '', url); } catch (_) {}
        return url;
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            if (window.showToast) window.showToast('PEQ URL copied to clipboard', 'success', 1500);
        } catch (e) {
            // Fallback: select input and execCommand
            output.focus();
            output.select();
            document.execCommand('copy');
            if (window.showToast) window.showToast('PEQ URL copied (fallback)', 'success', 1500);
        }
    }

    function updateQr(url) {
        // Use a CORS-friendly external QR API to avoid bundling libs
        const encoded = encodeURIComponent(url);
        // QuickChart provides reliable CORS headers and PNG output
        const src = `https://quickchart.io/qr?text=${encoded}&size=256`;
        if (qrImg) qrImg.src = src;
        if (qrDownload) qrDownload.href = src;
        if (qrLink) qrLink.href = url;
        if (qrTitleLink) {
            const title = getPeqTitle();
            qrTitleLink.textContent = title;
            qrTitleLink.href = url;
            qrTitleLink.title = `Open ${title}`;
        }
        return src;
    }

    function openCentered(href) {
        const w = 600, h = 600;
        const y = window.top.outerHeight / 2 + window.top.screenY - ( h / 2);
        const x = window.top.outerWidth / 2 + window.top.screenX - ( w / 2);
        window.open(href, '_blank', `popup=yes,width=${w},height=${h},top=${y},left=${x}`);
    }

    function ensureUrl() {
        const current = output.value || generate();
        return current;
    }

    async function getQrBlob(url) {
        const imgSrc = updateQr(url);
        const resp = await fetch(imgSrc, { mode: 'cors' });
        if (!resp.ok) throw new Error('Failed to fetch QR image');
        return await resp.blob();
    }

    async function tryWebShareWithImage(blob, text) {
        try {
            const file = new File([blob], 'peq-qr.png', { type: blob.type || 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text });
                if (window.showToast) window.showToast('Shared QR image successfully', 'success', 2000);
                return true;
            }
        } catch (err) {
            // fall through to next fallback
        }
        return false;
    }

    async function copyQrImageToClipboard(blob) {
        try {
            await navigator.clipboard.write([ new ClipboardItem({ [blob.type || 'image/png']: blob }) ]);
            return true;
        } catch (e) {
            return false;
        }
    }

    function isQrVisible() {
        if (!qrInline) return false;
        const style = window.getComputedStyle(qrInline);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        // Also ensure the element is in the document flow
        return !!(qrInline.offsetParent || qrInline.getClientRects().length);
    }

    // System/native share sheet button (separate from social flows)
    nativeBtn.addEventListener('click', async () => {
        const url = ensureUrl();
        if (!url) return;
        const peqTitle = getPeqTitle();
        const qrShown = isQrVisible();
        if (navigator.share) {
            try {
                if (qrShown) {
                    // When QR is visible: share ONLY the QR image (no URL), with title and byline text
                    try {
                        const blob = await getQrBlob(url);
                        const file = new File([blob], 'peq-qr.png', { type: blob.type || 'image/png' });
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({ title: peqTitle, files: [file], text: 'Brought to you by Pragmatic Audio' });
                            if (window.showToast) window.showToast('Shared QR image via system sheet', 'success', 2000);
                            return;
                        }
                    } catch (_) {
                        // If unable to get/share image, fall through to copying image or URL below
                    }
                }
                // If QR is not visible or image sharing not possible: share URL only (no image)
                await navigator.share({ title: peqTitle, url: url, text: 'Brought to you by Pragmatic Audio' });
                if (window.showToast) window.showToast('Shared via system sheet', 'success', 2000);
            } catch (e) {
                // User cancelled or failed; fallback copy depending on visibility
                if (qrShown) {
                    try {
                        const blob = await getQrBlob(url);
                        const copied = await copyQrImageToClipboard(blob);
                        if (copied && window.showToast) {
                            window.showToast('QR image copied. Paste it where you want to share.', 'info', 3000);
                        }
                    } catch (_) {
                        // If copying image fails, fallback to copying URL
                        await copyToClipboard(url);
                    }
                } else {
                    await copyToClipboard(url);
                }
            }
        } else {
            // Fallback: copy URL to clipboard (or image if visible and supported in future)
            if (qrShown) {
                try {
                    const blob = await getQrBlob(url);
                    const copied = await copyQrImageToClipboard(blob);
                    if (copied) return;
                } catch (_) {}
            }
            await copyToClipboard(url);
        }
    });

    // Toggle inline QR display
    toggleQrBtn.addEventListener('click', () => {
        const url = ensureUrl();
        if (!url) {
            if (window.showToast) window.showToast('No PEQ filters to encode', 'warning', 2000);
            return;
        }
        updateQr(url);
        if (qrInline) {
            qrInline.style.display = (qrInline.style.display === 'none' || !qrInline.style.display) ? 'block' : 'none';
        }
    });

    // Clicking the URL regenerates and copies the freshest URL (and updates QR if visible)
    output.addEventListener('click', async () => {
        const url = generate();
        if (!url) return;
        if (isQrVisible()) updateQr(url);
        await copyToClipboard(url);
    });

    // Regenerate on any PEQ change to keep URL and QR up-to-date
    document.addEventListener('UpdateExtensionFilters', () => {
        const url = generate();
        if (url && qrInline && qrInline.style.display === 'block') updateQr(url);
    });

    // Apply filters from URL if present before any generation to avoid reset
    try {
        const decoded = decodeFiltersFromUrl();
        if (decoded && Array.isArray(decoded.filters) && decoded.filters.length) {
            if (typeof context.filtersToElem === 'function') {
                context.filtersToElem(decoded.filters);
            }
            
            // If a specific phone was selected in the URL, store it for later use
            if (decoded.selectedPhone) {
                // Store the selected phone for use after the phone list is populated
                window.selectedPhoneName = decoded.selectedPhone;
                
                // Try to select it now if the select element already exists and has options
                try {
                    const eqPhoneSelect = document.querySelector('div.extra-eq select[name="phone"]');
                    if (eqPhoneSelect && eqPhoneSelect.options.length > 1) {
                        // Find the option that matches the selected phone
                        const options = Array.from(eqPhoneSelect.options);
                        const matchingOption = options.find(opt => opt.value === decoded.selectedPhone);
                        if (matchingOption) {
                            eqPhoneSelect.value = decoded.selectedPhone;
                        }
                    }
                } catch (_) {}
            }
            
            try { document.dispatchEvent(new CustomEvent('UpdateExtensionFilters')); } catch(_) {}
        }
    } catch (_) {}

    // If the URL contains new PEQ share parameters or selphone, automatically open the Equalizer tab
    try {
        const urlObj = new URL(window.location.href);
        const hasNewParams = [...urlObj.searchParams.keys()].some(k => 
            /^[FTGQD]\d+$/.test(k) || k === 'P' || k === 'selphone');
        if (hasNewParams && typeof window.showExtraPanel === 'function') {
            // Defer to allow graphtool to finish rendering and tabs to exist
            requestAnimationFrame(() => {
                try {
                    window.showExtraPanel();
                    const extraEq = document.querySelector('.extra-eq');
                    if (extraEq && typeof extraEq.scrollIntoView === 'function') {
                        extraEq.scrollIntoView({ behavior: 'instant', block: 'start' });
                    }
                    
                    // If we have a selected phone in the URL, try to select it after a short delay
                    // to ensure the phone list has been populated
                    if (urlObj.searchParams.has('selphone') && window.selectedPhoneName) {
                        setTimeout(() => {
                            try {
                                const eqPhoneSelect = document.querySelector('div.extra-eq select[name="phone"]');
                                if (eqPhoneSelect && eqPhoneSelect.options.length > 1) {
                                    // Find and select the matching option
                                    for (let i = 0; i < eqPhoneSelect.options.length; i++) {
                                        if (eqPhoneSelect.options[i].value === window.selectedPhoneName) {
                                            eqPhoneSelect.selectedIndex = i;
                                            // Trigger change event to apply the EQ
                                            eqPhoneSelect.dispatchEvent(new Event('input', { bubbles: true }));
                                            break;
                                        }
                                    }
                                }
                            } catch (_) {}
                        }, 500); // Give time for the phones list to populate
                    }
                } catch (_) {}
            });
        }
    } catch (_) {}
}

// CommonJS export (for older loaders if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = initializePeqUrlPlugin;
}

// ES Module default export for graphtool dynamic import
export default initializePeqUrlPlugin;
