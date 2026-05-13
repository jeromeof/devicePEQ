// Copyright 2025 : Pragmatic Audio
// chatWithPEQ Plugin — AI chat assistant using Chrome Prompt API (Gemini Nano)

async function initializeChatWithPEQPlugin(context) {

  // ── Configuration ─────────────────────────────────────────────────────────
  const cfg = (context && context.config) || {};
  const chatCfg = cfg.chatWithPEQ || {};

  const TITLE       = chatCfg.title      || 'Chat with Pragmatic Audio';
  const ICON_URL    = chatCfg.iconUrl    || 'https://www.pragmaticaudio.com/favicon.ico';
  const BUTTON_TEXT = chatCfg.buttonText || '';           // empty = icon-only
  const MAX_MSGS    = chatCfg.maxMessages  || 6;
  const MAX_TOOLS   = chatCfg.maxToolCalls || 3;

  // ── Session State ─────────────────────────────────────────────────────────
  const state = {
    currentHeadphone:       null,
    currentHeadphoneTraits: [],
    currentEQ:              [],
    currentGoal:            null,
    recentRecommendations:  [],
    userPreferences:        {},   // { likesBass, trebleSensitive, prefersNeutral, likesAnalytical }
    conversationSummary:    null,
    mode:                   'Discovery', // Discovery | Comparison | EQAdjustment | Explanation
    verifiedPhones:         []    // populated by searchForPhone / showHeadphone tool results
  };

  // ── Context helpers (same delegation pattern as getCurrentPhoneTargetNormalisation) ──
  const CTX = '[chatWithPEQ]';

  // ── Data Layer: Audio Glossary + Phone Book Details ───────────────────────
  const _PLUGIN_BASE = new URL('.', import.meta.url).href;
  const _PHONE_BOOK_URL = new URL('../../../data/phone_book.json', import.meta.url).href;

  let _glossary = null;      // { term_key: definition }
  let _phoneDetails = null;  // Map<lowerName, phoneEntry>

  async function ensureGlossary() {
    if (_glossary) return _glossary;
    try {
      const res = await fetch(_PLUGIN_BASE + 'audioGlossary.yml');
      const text = await res.text();
      _glossary = {};
      for (const line of text.split('\n')) {
        const i = line.indexOf(':');
        if (i < 1 || line.trimStart().startsWith('#')) continue;
        const key = line.slice(0, i).trim();
        const val = line.slice(i + 1).trim();
        if (key && val) _glossary[key] = val;
      }
      console.log(`${CTX} Glossary loaded: ${Object.keys(_glossary).length} terms`);
    } catch (e) {
      console.warn(`${CTX} Glossary load failed:`, e);
      _glossary = {};
    }
    return _glossary;
  }

  async function ensurePhoneDetails() {
    if (_phoneDetails) return _phoneDetails;
    _phoneDetails = new Map();
    try {
      const res = await fetch(_PHONE_BOOK_URL);
      const brands = await res.json();
      for (const brand of brands) {
        for (const phone of (brand.phones || [])) {
          const entry = { ...phone, brand: brand.name, fullName: `${brand.name} ${phone.name}` };
          _phoneDetails.set(entry.fullName.toLowerCase(), entry);
          _phoneDetails.set(phone.name.toLowerCase(), entry);
        }
      }
      console.log(`${CTX} PhoneDetails loaded: ${_phoneDetails.size} entries`);
    } catch (e) {
      console.warn(`${CTX} PhoneDetails load failed:`, e);
    }
    return _phoneDetails;
  }

  // Kick off loading in the background immediately
  Promise.all([ensureGlossary(), ensurePhoneDetails()]).catch(() => {});

  function glossaryLookup(phrase) {
    if (!_glossary) return [];
    const tokens = phrase.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
    if (!tokens.length) return [];

    const hits = [];
    const seen = new Set();

    function addHit(key) {
      if (seen.has(key) || !_glossary[key]) return;
      seen.add(key);
      hits.push({ term: key.replace(/_/g, ' '), definition: _glossary[key] });
    }

    // Try longest multi-word combos first (sliding window up to 4 tokens)
    for (let len = Math.min(tokens.length, 4); len >= 2; len--) {
      for (let i = 0; i <= tokens.length - len; i++) {
        addHit(tokens.slice(i, i + len).join('_'));
      }
    }

    // Individual tokens — exact then compound-key partial match
    for (const tok of tokens) {
      addHit(tok);
      for (const k of Object.keys(_glossary)) {
        if (!seen.has(k) && (k.startsWith(tok + '_') || k.endsWith('_' + tok) || k.includes('_' + tok + '_'))) {
          addHit(k);
        }
      }
    }

    return hits.slice(0, 6);
  }

  function phoneDetailsLookup(name) {
    if (!_phoneDetails) return null;
    const low = name.toLowerCase().trim();
    if (_phoneDetails.has(low)) return _phoneDetails.get(low);
    let best = null, bestLen = 0;
    for (const [key, entry] of _phoneDetails) {
      if (key.includes(low) && low.length > bestLen) { best = entry; bestLen = low.length; }
      else if (low.includes(key) && key.length > bestLen) { best = entry; bestLen = key.length; }
    }
    return best;
  }

  // Log which context functions are available so missing ones are immediately visible
  const ctxKeys = ['searchPhones','showPhone','searchTargets','showTarget','setEQModel',
                   'filtersToElem','applyEQ','getCurrentPhoneTargetNormalisation','loadPairedPhone'];
  console.warn(`${CTX} context functions:`, Object.fromEntries(ctxKeys.map(k => [k, typeof context[k]])));

  function searchPhones(query) {
    if (!context.searchPhones) { console.error(`${CTX} searchPhones not in context`); return []; }
    const results = context.searchPhones(query);
    console.log(`${CTX} searchPhones("${query}") → ${results.length} results`, results.map(r => r.name));
    return results;
  }
  function showPhone(fileName) {
    if (!context.showPhone) { console.error(`${CTX} showPhone not in context`); return { error: 'showPhone not available' }; }
    const r = context.showPhone(fileName);
    console.log(`${CTX} showPhone("${fileName}") →`, r);
    return r;
  }
  function searchTargets(query) {
    if (!context.searchTargets) { console.error(`${CTX} searchTargets not in context`); return []; }
    const results = context.searchTargets(query);
    console.log(`${CTX} searchTargets("${query}") → ${results.length} results`, results.map(r => r.name));
    return results;
  }
  function showTarget(fileName) {
    if (!context.showTarget) { console.error(`${CTX} showTarget not in context`); return { error: 'showTarget not available' }; }
    const r = context.showTarget(fileName);
    console.log(`${CTX} showTarget("${fileName}") →`, r);
    return r;
  }
  function setEQModel(phoneName) {
    if (!context.setEQModel) { console.error(`${CTX} setEQModel not in context`); return { error: 'setEQModel not available' }; }
    const r = context.setEQModel(phoneName);
    console.log(`${CTX} setEQModel("${phoneName}") →`, r);
    return r;
  }

  let messageHistory = []; // { role: 'user'|'assistant', content: string }

  // ── Tool: searchForPhone ──────────────────────────────────────────────────
  function searchForPhone(names) {
    console.log(`${CTX} tool searchForPhone called with names:`, names);
    const seen = new Set();
    const results = [];

    for (const name of names) {
      for (const p of searchPhones(name)) {
        if (!seen.has(p.fileName)) {
          seen.add(p.fileName);
          results.push(p);
        }
        if (results.length >= 8) break;
      }
      if (results.length >= 8) break;
    }

    if (results.length === 0) {
      return { found: false, message: 'No matching headphone found in database — do not describe or guess about this model' };
    }

    const foundNames = results.map(r => r.name).filter(Boolean);
    state.verifiedPhones = [...new Set([...state.verifiedPhones, ...foundNames])].slice(-30);

    // Update current headphone context when there's a clear single best match
    if (results.length === 1) {
      state.currentHeadphone = results[0].name;
    }

    if (results.length <= 3) {
      return {
        found: true, results,
        describable: true,
        suggestion: results.length === 1
          ? 'Exact match found — describe its sound signature (2-3 sentences), then ask if the user would like to see the measurement on the graph'
          : 'A few matches found — list them and ask which one the user means'
      };
    }
    return {
      found: true, results,
      suggestion: 'Multiple matches — present the list and ask the user which headphone they would like to view'
    };
  }

  // ── Tool: showHeadphone ───────────────────────────────────────────────────
  function showHeadphone(name) {
    // Guard against hallucinated names: if the passed name isn't in the verified list
    // but we have a confirmed current headphone, use that instead.
    const isVerified = state.verifiedPhones.some(v =>
      v.toLowerCase() === name.toLowerCase() ||
      name.toLowerCase().includes(v.toLowerCase()) ||
      v.toLowerCase().includes(name.toLowerCase())
    );
    let effectiveName = name;
    if (!isVerified && state.currentHeadphone) {
      console.warn(`${CTX} showHeadphone: "${name}" not in verified list — using current headphone "${state.currentHeadphone}" instead`);
      effectiveName = state.currentHeadphone;
    }

    const matches = searchPhones(effectiveName);
    if (!matches.length) return { error: `"${effectiveName}" not found in database` };

    const result = showPhone(matches[0].fileName);
    if (result.error) return result;

    state.currentHeadphone = result.name;
    if (!state.verifiedPhones.includes(result.name)) {
      state.verifiedPhones.push(result.name);
    }
    return result;
  }

  // ── Tool: lookupAudioContext ──────────────────────────────────────────────
  // Resolves any entity (term, brand, product type) by checking the glossary
  // first, then falling back to the phone book. On a clear phone match it also
  // loads the measurement graph automatically.
  async function lookupAudioContext(query) {
    await Promise.all([ensureGlossary(), ensurePhoneDetails()]);
    console.log(`${CTX} tool lookupAudioContext("${query}")`);

    const glossaryMatches = glossaryLookup(query);

    // If glossary returned nothing meaningful, try phone book
    if (glossaryMatches.length === 0) {
      const phone = phoneDetailsLookup(query);
      if (phone) {
        const phoneResult = {
          found: true,
          type: 'headphone',
          fullName: phone.fullName,
          description: phone.description || null,
          related: phone.related || [],
          price: phone.price || null,
          reviewLink: phone.reviewLink || null,
        };
        // Auto-load measurement for a clear single match
        const searchResult = searchForPhone([query]);
        if (searchResult.found && searchResult.results.length === 1) {
          showHeadphone(searchResult.results[0].name);
          phoneResult.measurementLoaded = true;
        }
        return phoneResult;
      }
      return { found: false, message: `No glossary terms or headphones matched "${query}"` };
    }

    return { found: true, type: 'glossary', glossaryMatches };
  }

  // ── Tool: findSimilarHeadphones ───────────────────────────────────────────
  // Returns headphones listed in the "related" field of the current or named phone.
  async function findSimilarHeadphones(name) {
    await ensurePhoneDetails();
    const targetName = name || state.currentHeadphone;
    if (!targetName) {
      return { error: 'No headphone specified and no current headphone in context' };
    }
    console.log(`${CTX} tool findSimilarHeadphones("${targetName}")`);

    const phone = phoneDetailsLookup(targetName);
    if (!phone) return { error: `"${targetName}" not found in phone book` };
    if (!phone.related || phone.related.length === 0) {
      return { found: false, basedOn: phone.fullName, message: 'No related headphones listed for this model' };
    }

    const similarHeadphones = phone.related.map(relName => {
      const rel = phoneDetailsLookup(relName);
      return { name: relName, description: rel?.description || null, price: rel?.price || null };
    });

    return { found: true, basedOn: phone.fullName, similarHeadphones };
  }

  // ── Tool: loadTarget ─────────────────────────────────────────────────────
  function loadTarget(name) {
    const all = searchTargets('');
    if (!all.length) return { error: 'No targets available' };

    // Direct search first
    let matches = name ? searchTargets(name) : all;

    // Word-by-word fallback: try each significant word in the query separately
    // so "Harman" matches "Harman 2019", "Harman Over-Ear", etc.
    if (!matches.length && name) {
      const words = name.split(/\s+/).filter(w => w.length > 2);
      for (const word of words) {
        const wordMatches = searchTargets(word);
        if (wordMatches.length) { matches = wordMatches; break; }
      }
    }

    if (!matches.length) {
      return {
        found: false,
        message: `"${name}" not found. Available targets:`,
        availableTargets: all.map(t => t.name),
        suggestion: 'Call loadTarget again with the exact name from availableTargets'
      };
    }

    // Single match or one clearly best match — load it
    if (matches.length === 1) {
      const result = showTarget(matches[0].fileName);
      if (result.error) return result;
      return { loaded: true, name: result.name };
    }

    // Multiple matches — present them so the user can pick
    return {
      found: true,
      multipleMatches: true,
      results: matches.map(t => t.name),
      suggestion: 'Multiple targets found — ask the user which one they want, then call loadTarget with the exact name'
    };
  }

  // ── Tool: updatePEQFilters ────────────────────────────────────────────────
  async function updatePEQFilters(filters) {
    if (!Array.isArray(filters) || filters.length === 0) {
      return { error: 'No filters provided' };
    }
    // Normalise field names — also accept "9" as a corrupted alias for "q" from Gemini Nano
    const normalised = filters.map(f => ({
      type: f.type  || 'PK',
      freq: f.frequency != null ? f.frequency : (f.freq != null ? f.freq : 1000),
      gain: f.gain  != null ? f.gain : 0,
      q:    f.qValue != null ? f.qValue : (f.q != null ? f.q : (f['9'] != null ? f['9'] : 1.0))
    }));

    // Switch the EQ model dropdown to the context headphone before applying.
    let modelWarning = null;
    if (state.currentHeadphone) {
      let switchResult = setEQModel(state.currentHeadphone);
      console.log(`[chatWithPEQ] setEQModel("${state.currentHeadphone}") attempt 1:`, switchResult);

      if (switchResult.error) {
        // Phone not in dropdown — load it onto the graph first (triggers updateEQPhoneSelect async)
        const matches = searchPhones(state.currentHeadphone);
        if (matches.length) {
          showPhone(matches[0].fileName);
          // Poll until the option appears in the dropdown (max 3s, check every 150ms)
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 150));
            switchResult = setEQModel(state.currentHeadphone);
            if (!switchResult.error) {
              console.log(`[chatWithPEQ] setEQModel succeeded after ${3000 - (deadline - Date.now())}ms`);
              break;
            }
          }
        }

        if (switchResult.error) {
          // Timed out — apply to whatever is currently active with a warning
          modelWarning = `Could not switch EQ model to "${state.currentHeadphone}" (not loaded on graph). EQ applied to currently active model instead.`;
          console.warn(`[chatWithPEQ] ${modelWarning}`);
        }
      }
    }

    context.filtersToElem(normalised);
    try {
      context.applyEQ();
    } catch (err) {
      console.error(`${CTX} applyEQ threw:`, err);
      return { error: `EQ applied to UI but applyEQ failed: ${err.message}` };
    }

    state.currentEQ = normalised;
    state.mode = 'EQAdjustment';
    return modelWarning
      ? { applied: true, warning: modelWarning, count: normalised.length }
      : { applied: true, count: normalised.length, headphone: state.currentHeadphone || 'current' };
  }

  // ── FR Descriptor Derivation ──────────────────────────────────────────────
  function deriveTraits(phone) {
    const ch = phone.rawChannels || [];
    if (ch.length === 0) return ['no measurement'];

    function avg(lo, hi) {
      const pts = ch.filter(p => p.freq >= lo && p.freq <= hi);
      return pts.length ? pts.reduce((s, p) => s + p.spl, 0) / pts.length : 0;
    }

    const ref         = avg(900,  1100);
    const bass        = avg(60,   250)  - ref;
    const midBass     = avg(250,  500)  - ref;
    const upperMids   = avg(2000, 5000) - ref;
    const treble      = avg(5000, 12000)- ref;
    const air         = avg(12000,18000)- ref;

    const traits = [];
    if      (bass > 5)    traits.push('heavy bass');
    else if (bass > 2)    traits.push('warm bass');
    else if (bass < -3)   traits.push('lean bass');

    if      (midBass > 3) traits.push('prominent mid-bass');

    if      (upperMids > 3)  traits.push('forward upper mids');
    else if (upperMids < -2) traits.push('recessed upper mids');

    if      (treble > 4)  traits.push('bright treble');
    else if (treble > 2)  traits.push('airy treble');
    else if (treble < -3) traits.push('dark treble');
    else if (treble < -1) traits.push('smooth treble');

    if      (air > 3)     traits.push('very airy');

    if (!traits.length ||
        (Math.abs(bass) <= 2 && Math.abs(upperMids) <= 1.5 && Math.abs(treble) <= 1.5)) {
      traits.push('neutral');
    }
    return traits;
  }

  // ── System Prompt ─────────────────────────────────────────────────────────
  const STATIC_PROMPT = `You are Pragmatic Audio, a specialist headphone and EQ assistant. Answer in 1-2 short sentences maximum. Only refuse (reply "I only help with headphones and EQ.") if the question is about something like cooking, sports, weather, or finance — never refuse headphone or audio questions of any kind.

CONTEXT RULE: If [AUDIO SESSION STATE] shows a current headphone, ALL follow-up questions ("what does it sound like?", "how's the bass?", "is it bright?", "any similar ones?", "what would you compare it to?") refer to THAT headphone. Answer directly from your knowledge — do not refuse.

RECOMMENDATION RULE: Questions like "any similar headphones?", "what else is like this?", "any alternatives?", "what would you recommend?" are valid headphone questions. Answer by calling searchForPhone with related model names, or suggest well-known alternatives from the Verified list.

When you need to use a tool, output ONLY a single line of raw JSON with no other text before or after it. Do NOT add any label, prefix, or explanation — just the JSON object:
{"tool":"lookupAudioContext","args":{"query":"<term, brand, or product type to look up>"}}
{"tool":"findSimilarHeadphones","args":{"name":"<headphone name, or omit to use current>"}}
{"tool":"searchForPhone","args":{"names":["<model name>"]}}
{"tool":"showHeadphone","args":{"name":"<full name>"}}
{"tool":"updatePEQFilters","args":{"filters":[{"type":"<LSQ|HSQ|PK>","freq":<Hz>,"q":<0.5-2.0>,"gain":<dB>}]}}
{"tool":"loadTarget","args":{"name":"<target name>"}}
{"tool":"searchImage","args":{"query":"<search terms>"}}

Rules:
- Answer questions about headphones, audio, sound signatures, EQ, or frequency response
- GLOSSARY-FIRST RULE: Before answering questions about an audio term (e.g. "what is slam?", "explain harshness", "what does airy mean?"), a brand name, or a product category, call lookupAudioContext with the key phrase. Use the returned definition(s) to ground your answer.
- PHONE LOOKUP RULE: When a user mentions a specific headphone model that is NOT yet in the Verified list AND you are not just describing it, call lookupAudioContext with the model name first. If it returns type="headphone" with a description, use that to answer and note if the measurement was auto-loaded. Only call searchForPhone additionally if you need search results for multi-model disambiguation.
- SIMILAR HEADPHONES RULE: When the user asks for alternatives, similar models, or "what else is like this?", call findSimilarHeadphones (omit name to use current context). Present the returned list with descriptions.
- If the current headphone is known (see session state), answer follow-up questions about it directly — do NOT call searchForPhone again for a headphone already in the Verified list
- TWO DISTINCT INTENTS — handle them differently:
  1. "Tell me about / what do you know about / what does X sound like" → call searchForPhone ONLY if X is not Verified, then DESCRIBE the sound. Do NOT call updatePEQFilters, showHeadphone, or any other tool.
  2. "Show me / load / display X on the graph" → call showHeadphone, reply ONE sentence confirming loaded. Do NOT describe sound.
- updatePEQFilters is ONLY for EQ adjustments the user explicitly requests ("make it bassier", "boost treble", "apply EQ"). NEVER call it when describing a headphone. NEVER call it when the user mentions a named target curve — use loadTarget instead.
- TARGET CURVE RULE: Whenever the user asks to "add", "show", "apply", or "load" any named target (Harman, Diffuse Field, IEF, AutoEQ, or any proper-noun target name), ALWAYS call loadTarget — NEVER call updatePEQFilters. If loadTarget returns multipleMatches, present the list and ask which one. If loadTarget returns found:false, reply ONLY with "I couldn't find that target — could you describe what you're looking for in more detail and I'll try again?" — do NOT suggest or apply any EQ filters as a substitute.
- Only call showHeadphone if the user explicitly wants to SEE or LOAD a measurement onto the graph
- Call loadTarget when the user wants to load or apply a target curve. Pass empty name "" to list all available targets.
- If asked about a model NOT in the Verified list, call searchForPhone first — if found:false, reply "I don't have that headphone in my database"
- Call searchImage only if the user asks to see a picture or photo
- EQ direction rules (ONLY apply when user explicitly requests EQ):
  * more bass / bassier / warmer → LSQ boost: freq 100, gain +3 to +5, q 0.7
  * less bass / tighter → LSQ cut: freq 100, gain -3 to -5, q 0.7
  * more treble / brighter / more air → HSQ boost: freq 8000, gain +2 to +4, q 0.7
  * less treble / smoother / less harsh → HSQ cut: freq 6000, gain -2 to -4, q 1.0
  * more presence / clearer vocals → PK boost: freq 2000, gain +2, q 1.5
  * less harsh mids / less fatiguing → PK cut: freq 4000, gain -2, q 1.2
  * V-shaped / fun → LSQ(100,+3,0.7) + HSQ(8000,+3,0.7) + PK(1000,-2,1.0)
  * NEVER reduce bass when user asks for MORE bass. NEVER boost when user asks for LESS.
- NEVER describe or guess specs for any headphone not in the Verified list`;

  function buildRuntimeState() {
    const eq = state.currentEQ.length
      ? state.currentEQ.map(f => `${f.type}@${f.freq}Hz ${f.gain}dB Q${f.q}`).join(' | ')
      : 'none';

    const prefs = Object.entries(state.userPreferences)
      .filter(([, v]) => v)
      .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase())
      .join(', ') || 'none';

    const recs = state.recentRecommendations.slice(-3).join(', ') || 'none';

    const verified = state.verifiedPhones.length
      ? state.verifiedPhones.slice(-20).join(', ')
      : 'none yet — use searchForPhone first';

    const currentCtx = state.currentHeadphone
      ? `Currently discussing: ${state.currentHeadphone} — answer follow-up questions about this headphone directly.`
      : `Currently discussing: none — ask user which headphone they mean if unclear.`;

    return `[AUDIO SESSION STATE]
${currentCtx}
Traits: ${state.currentHeadphoneTraits.join(', ') || 'unknown'}
EQ: ${eq}
User preferences: ${prefs}
Mode: ${state.mode}
Verified headphones (ONLY these may be named): ${verified}${state.conversationSummary ? `\nSummary: ${state.conversationSummary}` : ''}`;
  }

  // ── Tool Call Parsing ─────────────────────────────────────────────────────
  function looksLikeToolCallInProgress(text) {
    const t = text.trimStart();
    // Starts with JSON or fence
    if (t.startsWith('{') || /^[`'"]{3}/.test(t)) return true;
    // EQ shorthand at start: "LSQ@ 100Hz..." or "PK@1kHz..."
    if (/^(LSQ|HSQ|PK)\s*@?\s*[\d.]/i.test(t)) return true;
    // Embedded tool call anywhere: model mixed prose + JSON (e.g. "Here is a search:\n{\"tool\":...")
    if (/\{"tool"\s*:/.test(text)) return true;
    // Labeled format the model copies from the system prompt examples: "SEARCH: {", "SHOW: {", etc.
    if (/\b(SEARCH|SHOW|EQ|TARGET|IMAGE)\s*:\s*\{/.test(text)) return true;
    return false;
  }

  function parseToolCall(text) {
    const trimmed = text.trim();
    // Strip any 3-char code fence (``` or ''' or """) with optional language tag
    const stripped = trimmed
      .replace(/^[`'"]{3}(?:json)?\s*/i, '')
      .replace(/\s*[`'"]{3}\s*$/, '')
      .trim();

    // Try clean JSON parse first
    if (stripped.startsWith('{')) {
      try {
        const obj = JSON.parse(stripped);
        if (obj.tool && obj.args) return obj;
        console.warn(`${CTX} parseToolCall: JSON parsed but missing tool/args — keys: ${Object.keys(obj).join(', ')}`);
      } catch (jsonErr) {
        console.warn(`${CTX} parseToolCall: JSON.parse failed (${jsonErr.message}) — falling back to regex`);
      }
    } else {
      console.warn(`${CTX} parseToolCall: response does not start with '{' — not a JSON tool call. First 60 chars: ${JSON.stringify(stripped.slice(0, 60))}`);
    }

    // ── Fallback: regex extraction for malformed Gemini Nano output ──────────
    // Works even when JSON has wrong brackets, stray chars, missing colons/commas
    const toolMatch = text.match(/"tool"\s*[":=\s]*\s*"([^"]+)"/);
    if (!toolMatch) {
      // Log a truncated snippet to help diagnose what the model actually said
      const snippet = text.replace(/\s+/g, ' ').slice(0, 120);
      console.warn(`${CTX} parseToolCall: no "tool" key found anywhere — model gave plain prose. Response snippet: "${snippet}"`);
      return null;
    }
    const tool = toolMatch[1];
    console.warn(`${CTX} parseToolCall: regex found tool="${tool}" — attempting arg extraction`);

    if (tool === 'updatePEQFilters') {
      // Extract individual filter property values positionally
      const types  = [...text.matchAll(/"type"\s*[":=\s]*\s*"([^"]+)"/g)].map(m => m[1]);
      const freqs  = [...text.matchAll(/"freq(?:uency)?"\s*[":=\s]*\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      const gains  = [...text.matchAll(/"gain"\s*[":=\s]*\s*(-?[\d.]+)/g)].map(m => parseFloat(m[1]));
      // Accept "q", "qValue", or common OCR/model corruptions like "9", "q_"
      const qs     = [...text.matchAll(/"(?:q|qValue|9|q_)"\s*[":=\s]*\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      const count  = Math.max(types.length, freqs.length, gains.length, 1);
      const filters = Array.from({ length: count }, (_, i) => ({
        type: types[i] || 'PK',
        freq: freqs[i] ?? 1000,
        gain: gains[i] ?? 0,
        q:    qs[i]    ?? 1.0,
      }));
      console.log('[chatWithPEQ] parseToolCall fallback — extracted filters:', filters);
      return { tool, args: { filters } };
    }

    if (tool === 'searchForPhone') {
      const namesBlock = text.match(/"names"\s*[":=\s]*\s*\[([^\]]*)\]/);
      const names = namesBlock
        ? (namesBlock[1].match(/"([^"]+)"/g) || []).map(n => n.replace(/"/g, ''))
        : (text.match(/"names"\s*[":=\s]*\s*"([^"]+)"/) || [, ''])[1].split(',').map(s => s.trim()).filter(Boolean);
      if (names.length) return { tool, args: { names } };
    }

    if (tool === 'showHeadphone' || tool === 'loadTarget' || tool === 'findSimilarHeadphones') {
      const nameMatch = text.match(/"name"\s*[":=\s]*\s*"([^"]+)"/);
      // findSimilarHeadphones may omit name entirely (uses current context)
      return tool === 'findSimilarHeadphones'
        ? { tool, args: { name: nameMatch ? nameMatch[1] : '' } }
        : (nameMatch ? { tool, args: { name: nameMatch[1] } } : null);
    }

    if (tool === 'lookupAudioContext' || tool === 'searchImage') {
      const qMatch = text.match(/"(?:query)"\s*[":=\s]*\s*"([^"]+)"/);
      if (!qMatch) console.warn(`${CTX} parseToolCall: tool="${tool}" but no "query" arg found`);
      return qMatch ? { tool, args: { query: qMatch[1] } } : null;
    }

    console.warn(`${CTX} parseToolCall: tool="${tool}" matched but no arg-extraction branch handled it`);

    // ── Last resort: EQ shorthand text e.g. "LSQ@ 100Hz 5dB Q0.7" ─────────────
    // Matches lines like: PK@1kHz -3dB Q1.5  /  HSQ 8000 Hz +4 dB q0.7  /  LSQ@100Hz 5dB Q0.7
    const EQ_LINE = /\b(LSQ|HSQ|PK)\s*@?\s*([\d.]+)\s*(?:k[Hh]z|[Hh]z|hz)?\s*([+-]?[\d.]+)\s*d?[Bb]\s*[Qq]\s*([\d.]+)/gi;
    const eqMatches = [...text.matchAll(EQ_LINE)];
    if (eqMatches.length) {
      const filters = eqMatches.map(m => ({
        type: m[1].toUpperCase(),
        freq: parseFloat(m[2]) * (m[0].toLowerCase().includes('khz') ? 1000 : 1),
        gain: parseFloat(m[3]),
        q:    parseFloat(m[4]),
      }));
      console.log(`${CTX} parseToolCall EQ shorthand → updatePEQFilters`, filters);
      return { tool: 'updatePEQFilters', args: { filters } };
    }

    return null;
  }

  // ── Tool: searchImage ────────────────────────────────────────────────────
  function searchImage(query) {
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return { opened: true, query };
  }

  async function executeToolCall(toolName, args) {
    console.warn(`${CTX} executeToolCall: tool="${toolName}" args=`, JSON.stringify(args));
    let result;
    switch (toolName) {
      case 'searchForPhone':        result = searchForPhone(args.names || []); break;
      case 'showHeadphone':         result = showHeadphone(args.name || ''); break;
      case 'loadTarget':            result = loadTarget(args.name || ''); break;
      case 'updatePEQFilters':      result = await updatePEQFilters(args.filters || []); break;
      case 'searchImage':           result = searchImage(args.query || ''); break;
      case 'lookupAudioContext':    result = await lookupAudioContext(args.query || ''); break;
      case 'findSimilarHeadphones': result = await findSimilarHeadphones(args.name || ''); break;
      default:                      result = { error: `Unknown tool: ${toolName}` };
    }
    console.warn(`${CTX} executeToolCall: tool="${toolName}" result=`, JSON.stringify(result));
    return result;
  }

  // ── State Updates from User Message ──────────────────────────────────────
  function updateStateFromUserMessage(text) {
    const low = text.toLowerCase();
    // If the user mentions a headphone from the verified list, make it the current context
    for (const name of state.verifiedPhones) {
      if (name && low.includes(name.toLowerCase())) {
        state.currentHeadphone = name;
        break;
      }
    }
    if (/\beq\b|filter|boost|cut|adjust|peq/.test(low)) {
      state.mode = 'EQAdjustment';
    } else if (/compar|vs\b|versus|similar|alternative|like (the|this|it)|instead|other.*headphone|else.*like/.test(low)) {
      state.mode = 'Comparison';
    } else if (/\bwhy\b|\bhow\b|explain|what (is|are|does|do|did)|how (does|do)|sound like|signature|bright|dark|warm|bass|treble|mids?/.test(low)) {
      state.mode = 'Explanation';
    } else if (/find|recommend|suggest|looking for|any other|what else|what would you/.test(low)) {
      state.mode = 'Discovery';
    }
    if (/warm|bass(ier|y)?\b|more bass|fuller|low end/.test(low)) state.userPreferences.likesBass = true;
    if (/less bass|tighter|leaner|clean.*low/.test(low))          state.userPreferences.likesBass = false;
    if (/bright|harsh|sharp|sibilant/.test(low)) state.userPreferences.trebleSensitive = true;
    if (/neutral|accurate|flat|reference/.test(low)) state.userPreferences.prefersNeutral = true;
    if (/detail|analytical|resolving/.test(low)) state.userPreferences.likesAnalytical = true;
  }

  // ── AI Inference ──────────────────────────────────────────────────────────
  async function runInference(userMessage, onChunk = null) {
    const api = resolveLanguageModelAPI();
    if (!api) {
      throw new Error(
        'Chrome Prompt API unavailable.\n' +
        'Enable it at chrome://flags/#prompt-api-for-gemini-nano\n' +
        'Requires Chrome 127+ with Gemini Nano downloaded.'
      );
    }

    // No language opts — working Chrome 148 implementations omit these entirely
    const available = await getAvailability(api);
    if (available === 'no') {
      throw new Error('Gemini Nano not available on this device.');
    }

    const fullSystemPrompt = STATIC_PROMPT + '\n\n' + buildRuntimeState();

    let history = messageHistory.slice(-MAX_MSGS);
    while (history.length > 0 && history[0].role !== 'user') history = history.slice(1);

    // Per the @types/dom-chromium-ai spec:
    // - systemPrompt is gone; system message goes first in initialPrompts
    // - topK/temperature are deprecated for web pages (extensions only)
    // - language spec is expectedInputs/expectedOutputs with { type, languages }
    const initialPrompts = [
      { role: 'system', content: fullSystemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
    ];

    const session = await api.create({
      expectedInputs:  [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts,
    });

    let response = '';
    let currentPrompt = userMessage;

    try {
      for (let i = 0; i < MAX_TOOLS + 1; i++) {
        console.warn(`[chatWithPEQ] runInference: turn ${i + 1}, prompt="${currentPrompt.slice(0, 80)}…"`);
        const stream = session.promptStreaming(currentPrompt);
        response = '';
        let chunkCount = 0;
        let suppressedAsToolCall = false;
        for await (const chunk of stream) {
          response += chunk; // API sends deltas — accumulate
          chunkCount++;
          if (looksLikeToolCallInProgress(response)) {
            if (!suppressedAsToolCall) {
              // Just flipped — clear any text already shown to the user
              suppressedAsToolCall = true;
              console.warn(`[chatWithPEQ] chunk ${chunkCount}: tool call pattern detected mid-stream — clearing UI (${response.length} chars)`);
              if (onChunk) onChunk(null);
            }
          } else if (!suppressedAsToolCall && onChunk) {
            onChunk(response);
          }
        }
        console.warn(`[chatWithPEQ] stream complete: ${chunkCount} chunks, ${response.length} chars, suppressed=${suppressedAsToolCall}, starts=${JSON.stringify(response.trimStart().slice(0,20))}`);
        console.warn(`[chatWithPEQ] full response:`, response);

        const toolCall = parseToolCall(response);
        console.warn(`${CTX} parseToolCall result:`, toolCall ? `tool="${toolCall.tool}"` : 'null (no tool call)');
        if (!toolCall) {
          console.warn(`${CTX} final answer: "${response.slice(0, 120)}${response.length > 120 ? '…' : ''}"`);
          // Was suppressed as a suspected tool call but turned out not to be — flush to UI now
          if (suppressedAsToolCall && onChunk) {
            console.warn(`[chatWithPEQ] flushing suppressed non-tool response to UI`);
            onChunk(response);
          }
          break;
        }

        console.warn(`[chatWithPEQ] tool call detected: tool="${toolCall.tool}" args=`, toolCall.args);
        if (onChunk) onChunk(null); // signal "tool running" — also clears any stale partial text
        const result = await executeToolCall(toolCall.tool, toolCall.args);
        console.warn(`[chatWithPEQ] tool "${toolCall.tool}" result:`, result);
        const confirmHint = {
          lookupAudioContext: result.type === 'glossary'
            ? `Use the glossary definitions to answer the user's question accurately in 1-2 sentences. Do not pad with filler.`
            : result.type === 'headphone'
              ? `Use the headphone description from the tool result to answer the question. ${result.measurementLoaded ? 'The measurement has been auto-loaded on the graph — mention that.' : ''} Keep it to 2-3 sentences.`
              : `The lookup found nothing — answer from your general knowledge but flag if you are uncertain.`,
          findSimilarHeadphones: result.found
            ? `Present the similar headphones to the user. For each, give the name and 1 short sentence from its description. Keep the list concise.`
            : `No similar headphones were found in the database. Suggest a few well-known alternatives from your general knowledge instead.`,
          searchForPhone:  result.describable
            ? `Describe the headphone's sound signature and character in 2-3 sentences. Then ask if the user would like to see the measurement on the graph.`
            : `Follow the suggestion in the tool result. Do not invent headphone names.`,
          showHeadphone:   `The headphone is now loaded on the graph. Reply in 1 sentence confirming it is visible. Do NOT describe the sound — the user can see the graph.`,
          loadTarget: result.loaded
            ? `The target curve "${result.name}" is now loaded. Reply in 1 sentence confirming it is visible.`
            : result.multipleMatches
              ? `Multiple targets matched. List them and ask the user which one they want — do NOT apply any EQ.`
              : `Target not found. Reply ONLY: "I couldn't find that target — could you describe what you're looking for in more detail and I'll try again?" Do NOT suggest or apply any EQ filters.`,
          updatePEQFilters: result.warning
            ? `The EQ was applied but with a problem: ${result.warning}. Tell the user honestly — suggest they load the headphone on the graph first.`
            : `The EQ has been applied to ${result.headphone || 'the headphone'}. Reply in 1 sentence confirming the change.`,
        }[toolCall.tool] || `Answer the user's question based on the tool result.`;
        currentPrompt = `Tool result for ${toolCall.tool}: ${JSON.stringify(result)}\n${confirmHint}`;
      }
    } finally {
      session.destroy();
    }

    return response;
  }

  // ── Overlay UI ────────────────────────────────────────────────────────────
  const CSS_ID = 'chatWithPEQCSS';
  if (!document.getElementById(CSS_ID)) {
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = `
      .chat-peq-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9997;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--background-color, #fff);
        border: 1px solid var(--background-color-contrast-more, #ccc) !important;
        padding: 0 !important;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.12);
        display: flex; align-items: center; justify-content: center;
        transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
      }
      .chat-peq-fab:hover {
        transform: scale(1.08);
        box-shadow: 0 4px 16px rgba(0,0,0,0.18);
        border-color: var(--accent-color, #1a6ef5) !important;
      }
      .chat-peq-fab img {
        width: 30px; height: 30px; border-radius: 50%;
        pointer-events: none;
      }
      .chat-peq-fab-fallback {
        font-size: 26px; line-height: 1; pointer-events: none;
      }
      /* Tooltip */
      .chat-peq-fab::after {
        content: attr(data-tooltip);
        position: absolute;
        right: calc(100% + 10px);
        top: 50%;
        transform: translateY(-50%);
        background: var(--font-color-primary, #111);
        color: var(--background-color, #fff);
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        padding: 5px 10px;
        border-radius: 6px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 150ms ease;
      }
      .chat-peq-fab:hover::after { opacity: 1; }

      #chatWithPEQOverlay {
        display: none; position: fixed; inset: 0;
        background: rgba(0,0,0,0.25); z-index: 9998;
        align-items: flex-end; justify-content: flex-end; padding: 16px;
      }
      #chatWithPEQOverlay.open { display: flex; }

      #chatWithPEQPanel {
        background: var(--background-color, #fff);
        color: var(--font-color-primary, #111);
        border: 1px solid var(--background-color-contrast-more, #ccc);
        border-radius: 14px;
        width: 360px; max-width: calc(100vw - 32px);
        height: 480px; max-height: calc(100vh - 80px);
        display: flex; flex-direction: column;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12);
        overflow: hidden;
      }

      #chatWithPEQHeader {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--background-color-contrast, #e5e5e5);
        flex-shrink: 0;
      }
      #chatWithPEQHeader img { width: 20px; height: 20px; border-radius: 4px; opacity: 0.8; }
      #chatWithPEQHeader span {
        font-weight: 600; font-size: 13px; flex: 1;
        color: var(--font-color-primary, #111);
      }
      #chatWithPEQClose {
        background: none; border: none; cursor: pointer; padding: 0 4px;
        color: var(--accent-color-contrast-inactive, #888);
        font-size: 1.2em; line-height: 1;
      }
      #chatWithPEQClose:hover { color: var(--font-color-primary, #111); }

      #chatWithPEQStatus {
        display: flex; align-items: center; justify-content: space-between;
        padding: 3px 14px; font-size: 11px;
        color: var(--accent-color-contrast-inactive, #888);
        border-bottom: 1px solid var(--background-color-contrast, #e5e5e5);
        flex-shrink: 0;
      }
      #chatWithPEQStatus.error { color: #c53030; }
      #chatWithPEQStatus.ok    { color: #2e7d32; }
      #chatWithPEQStatusText   { flex: 1; }
      #chatWithPEQWarning {
        font-size: 10px; font-style: italic;
        color: var(--accent-color-contrast-inactive, #aaa);
        white-space: nowrap;
        margin-left: 8px;
      }

      #chatWithPEQMessages {
        flex: 1; overflow-y: auto; padding: 12px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .chat-msg {
        max-width: 88%; padding: 7px 11px; border-radius: 10px;
        font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
      }
      .chat-msg.user {
        align-self: flex-end;
        background: var(--accent-color, #1a6ef5); color: #fff;
        border-bottom-right-radius: 3px;
      }
      .chat-msg.assistant {
        align-self: flex-start;
        background: var(--background-color-contrast, #f0f0f0);
        color: var(--font-color-primary, #111);
        border: 1px solid var(--background-color-contrast, #e8e8e8);
        border-bottom-left-radius: 3px;
      }
      .chat-msg.thinking {
        align-self: flex-start;
        background: transparent;
        color: var(--accent-color-contrast-inactive, #888);
        font-style: italic; font-size: 12px; border: none; padding: 4px 2px;
      }

      #chatWithPEQInputRow {
        display: flex; gap: 6px; padding: 10px 12px;
        border-top: 1px solid var(--background-color-contrast, #e5e5e5);
        flex-shrink: 0;
      }
      #chatWithPEQInput {
        flex: 1;
        background: var(--background-color, #fff);
        border: 1px solid var(--background-color-contrast-more, #ccc);
        border-radius: 8px;
        color: var(--font-color-primary, #111);
        padding: 7px 10px; font-size: 13px; outline: none;
        resize: none; font-family: inherit; max-height: 80px;
      }
      #chatWithPEQInput:focus {
        border-color: var(--accent-color, #1a6ef5);
      }
      #chatWithPEQSend {
        background: var(--accent-color, #1a6ef5); color: #fff;
        border: none; border-radius: 8px;
        padding: 7px 14px; cursor: pointer;
        font-weight: 500; font-size: 13px;
        text-transform: none !important;
        transition: opacity 150ms ease;
      }
      #chatWithPEQSend:disabled { opacity: 0.4; cursor: not-allowed; }
      #chatWithPEQSend:hover:not(:disabled) { opacity: 0.85; }
    `;
    document.head.appendChild(style);
  }

  // Circular Intercom-style FAB fixed to bottom-right of the page
  const fab = document.createElement('button');
  fab.className = 'chat-peq-fab';
  fab.setAttribute('data-tooltip', TITLE);
  fab.setAttribute('aria-label', TITLE);

  const fabIcon = document.createElement('img');
  fabIcon.src = ICON_URL;
  fabIcon.alt = '';
  fabIcon.onerror = () => {
    fabIcon.style.display = 'none';
    const fallback = document.createElement('span');
    fallback.className = 'chat-peq-fab-fallback';
    fallback.textContent = '💬';
    fab.appendChild(fallback);
  };
  fab.appendChild(fabIcon);
  fab.addEventListener('click', openOverlay);
  document.body.appendChild(fab);

  // Build overlay DOM
  const overlay = document.createElement('div');
  overlay.id = 'chatWithPEQOverlay';
  overlay.innerHTML = `
    <div id="chatWithPEQPanel">
      <div id="chatWithPEQHeader">
        <img id="chatWithPEQHeaderIcon" src="${ICON_URL}" alt="PA" onerror="this.style.display='none'">
        <span>${TITLE}</span>
        <button id="chatWithPEQClose" title="Close">✕</button>
      </div>
      <div id="chatWithPEQStatus">
        <span id="chatWithPEQStatusText">Checking AI availability…</span>
        <span id="chatWithPEQWarning">Note: This model will hallucinate</span>
      </div>
      <div id="chatWithPEQMessages"></div>
      <div id="chatWithPEQInputRow">
        <textarea id="chatWithPEQInput" rows="1" placeholder="Ask about headphones or EQ…" disabled></textarea>
        <button id="chatWithPEQSend" disabled>Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const msgList   = document.getElementById('chatWithPEQMessages');
  const statusBar = document.getElementById('chatWithPEQStatus');
  const input     = document.getElementById('chatWithPEQInput');
  const sendBtn   = document.getElementById('chatWithPEQSend');

  document.getElementById('chatWithPEQClose').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });

  // Keyboard: ESC closes, Enter sends
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeOverlay();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  sendBtn.addEventListener('click', handleSend);

  function openOverlay() {
    overlay.classList.add('open');
    checkAIAvailability();
    // Auto-inject current headphone context if none set
    injectCurrentPageContext();
    input.focus();
  }

  function closeOverlay() {
    overlay.classList.remove('open');
  }

  // ── Context from Page ─────────────────────────────────────────────────────
  function injectCurrentPageContext() {
    if (state.currentHeadphone) return;
    try {
      const { phoneObj } = context.getCurrentPhoneTargetNormalisation();
      if (phoneObj && (phoneObj.fullName || phoneObj.fileName)) {
        state.currentHeadphone = phoneObj.fullName || phoneObj.fileName;
        state.currentHeadphoneTraits = deriveTraits(phoneObj);
        // Read current filters
        state.currentEQ = context.elemToFilters(false).filter(f => f.gain !== 0 || f.freq);
      }
    } catch { /* page may not have a loaded phone */ }
  }

  // ── Resolve AI API (handles multiple Chrome versions) ────────────────────
  function resolveLanguageModelAPI() {
    // Chrome 127-131: window.ai.languageModel
    if (window.ai?.languageModel) return window.ai.languageModel;
    // Chrome 132+: window.LanguageModel (proposed top-level global)
    if (typeof window.LanguageModel !== 'undefined') return window.LanguageModel;
    // Some builds expose window.ai.assistant
    if (window.ai?.assistant) return window.ai.assistant;
    return null;
  }

  // ── AI Availability Check ─────────────────────────────────────────────────
  // Normalise availability across Chrome API versions:
  // Chrome 127-131: api.capabilities() → { available: 'readily'|'after-download'|'no' }
  // Chrome 132+:    api.availability() → 'readily'|'after-download'|'no'  (string)
  async function getAvailability(api) {
    if (typeof api.availability === 'function') {
      // Spec: availability(options?: LanguageModelCreateCoreOptions) → Promise<Availability>
      // Availability = "unavailable" | "downloadable" | "downloading" | "available" (new)
      //              | "no" | "after-download" | "readily" (old)
      const result = await api.availability({
        expectedInputs:  [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      return typeof result === 'string' ? result : (result?.available ?? 'unavailable');
    }
    if (typeof api.capabilities === 'function') {
      const caps = await api.capabilities();
      return caps?.available ?? 'no';
    }
    return 'unavailable';
  }

  async function checkAIAvailability() {
    const api = resolveLanguageModelAPI();
    if (!api) {
      const aiKeys = Object.keys(window).filter(k => /^(ai|LanguageModel|Summarizer|Translator|Rewriter)/i.test(k));
      const hint = aiKeys.length ? `window keys found: ${aiKeys.join(', ')}` : 'no window.ai keys found';
      setStatus(`Chrome Prompt API not detected (${hint}). Enable chrome://flags/#prompt-api-for-gemini-nano`, 'error');
      return false;
    }
    try {
      const available = await getAvailability(api);
      if (available === 'no' || available === 'unavailable') {
        setStatus('Gemini Nano not available on this device. Check chrome://on-device-internals/', 'error');
        return false;
      }
      if (available === 'after-download' || available === 'downloadable' || available === 'downloading') {
        setStatus('Gemini Nano downloading… try again shortly.', '');
        return false;
      }
      setStatus('Gemini Nano ready', 'ok');
      input.disabled = false;
      sendBtn.disabled = false;
      return true;
    } catch (err) {
      setStatus(`AI check failed: ${err.message}`, 'error');
      return false;
    }
  }

  function setStatus(text, cls) {
    const textEl = document.getElementById('chatWithPEQStatusText');
    if (textEl) textEl.textContent = text; else statusBar.textContent = text;
    statusBar.className = '';
    if (cls === 'ok') statusBar.classList.add('ok');
    if (cls === 'error') statusBar.classList.add('error');
  }

  // ── Message Rendering ─────────────────────────────────────────────────────
  function appendMessage(role, text) {
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.textContent = text;
    msgList.appendChild(el);
    msgList.scrollTop = msgList.scrollHeight;
    return el;
  }

  function appendThinking() {
    const el = document.createElement('div');
    el.className = 'chat-msg thinking';
    el.textContent = 'Thinking…';
    msgList.appendChild(el);
    msgList.scrollTop = msgList.scrollHeight;
    return el;
  }

  // ── Send Handler ──────────────────────────────────────────────────────────
  let isSending = false;

  async function handleSend() {
    const text = input.value.trim();
    if (!text || isSending) return;

    isSending = true;
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    appendMessage('user', text);
    updateStateFromUserMessage(text);

    const thinking = appendThinking();
    setStatus('Thinking…', '');
    let replyEl = null;

    let reply = '';
    try {
      reply = await runInference(text, (chunk) => {
        if (chunk === null) {
          // Tool call running — discard any partial text, reset to thinking bubble
          if (replyEl) {
            replyEl.remove();
            replyEl = null;
            msgList.appendChild(thinking); // re-add thinking bubble if it was removed
          }
          thinking.textContent = '⚙️ Running tool…';
          msgList.scrollTop = msgList.scrollHeight;
          return;
        }
        // First text chunk: swap thinking bubble for a live reply element
        if (!replyEl) {
          thinking.remove();
          replyEl = appendMessage('assistant', '');
        }
        replyEl.textContent = chunk;
        msgList.scrollTop = msgList.scrollHeight;
      });
      setStatus('Gemini Nano ready', 'ok');
    } catch (err) {
      reply = `Error: ${err.message}`;
      setStatus(`Error: ${err.message}`, 'error');
    }

    // If streaming never fired (error path), ensure thinking is removed
    if (!replyEl) {
      thinking.remove();
      appendMessage('assistant', reply);
    } else {
      // Streaming complete — ensure final text is set (handles edge case of empty last chunk)
      replyEl.textContent = reply || replyEl.textContent;
    }

    // Update rolling history
    messageHistory.push({ role: 'user',      content: text  });
    messageHistory.push({ role: 'assistant', content: reply });
    // Keep rolling window
    if (messageHistory.length > MAX_MSGS * 2) {
      messageHistory = messageHistory.slice(-MAX_MSGS * 2);
    }

    isSending = false;
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

export default initializeChatWithPEQPlugin;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = initializeChatWithPEQPlugin;
}
