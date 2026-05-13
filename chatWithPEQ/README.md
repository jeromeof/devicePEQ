# chatWithPEQ Plugin

An AI chat assistant plugin for the CrinGraph-based headphone measurement tool. Uses Chrome's built-in **Gemini Nano** model (via the Chrome Prompt API) to answer headphone and EQ questions, and can call tools to interact with the graph tool in real time.

## Requirements

- Chrome 127+ with Gemini Nano downloaded
- Enable `chrome://flags/#prompt-api-for-gemini-nano`
- The host page must expose `window.allPhones`, `window.showPhone`, and the graphtool plugin context

## Integration

The plugin is loaded as an extra plugin alongside `devicePEQ`:

```js
let extraEQplugins = [
  './devicePEQ/plugin.js',
  './chatWithPEQ/plugin.js',
];
```

It receives the standard graphtool plugin context:

```js
{
  filtersToElem,     // (filters[]) → void  — writes filters to the EQ UI
  applyEQ,           // () → void           — applies the current EQ
  config: {
    chatWithPEQ: {
      title:        'Chat with these measurements',  // panel header
      iconUrl:      'https://...favicon.ico',        // FAB/header icon
      buttonText:   '',                               // empty = icon only
      maxMessages:  6,                               // rolling history window
      maxToolCalls: 3,                               // max tool-call turns per message
    }
  }
}
```

## UI

A floating action button (FAB) is injected next to other plugin controls (`#peqPluginControls`). Clicking it opens a fixed chat panel (360×480px) styled using the same CSS variables as devicePEQ (`--background-color`, `--accent-color`, `--font-color-primary`, etc.).

## Tools

The model can call four tools by outputting raw JSON (or a `\`\`\`json` fenced block):

### `searchForPhone`
```json
{"tool":"searchForPhone","args":{"names":["HD 600"]}}
```
Searches `window.allPhones` for matching headphones. Returns `{ found: true, results: [{name}] }` or `{ found: false, message: "..." }`. Adds confirmed names to the **verified list** — the model may only mention headphones from this list.

### `showHeadphone`
```json
{"tool":"showHeadphone","args":{"name":"Sennheiser HD 600"}}
```
Calls `window.showPhone()` to load the headphone onto the graph. Only triggered when the user explicitly wants to **see or load** the measurement.

### `updatePEQFilters`
```json
{"tool":"updatePEQFilters","args":{"filters":[{"type":"PK","freq":1000,"q":1.0,"gain":-2}]}}
```
Calls `context.filtersToElem(filters)` then `context.applyEQ()` to update the EQ in real time. Accepted filter fields: `type` (PK/LSQ/HSQ), `freq`, `q`, `gain`. Also accepts `frequency`/`qValue` as aliases.

### `searchImage`
```json
{"tool":"searchImage","args":{"query":"Sennheiser HD 600 headphone"}}
```
Opens a Google Images search in a new tab. No API key required.

## Anti-Hallucination

The model is constrained to only name headphones from a **verified list** that is:
- Seeded with up to 20 real names from `window.allPhones` on load
- Extended by every `searchForPhone` result (capped at 30 most recent)
- Extended when `showHeadphone` succeeds
- Injected into every prompt turn as `Verified headphones (ONLY these may be named)`

If asked about an unverified model, the model is instructed to call `searchForPhone` first. If the search returns `found: false`, it replies that the headphone isn't in the database rather than guessing.

## Streaming & Tool Call Detection

Responses are streamed chunk by chunk. A response is suppressed from the UI while being accumulated if it starts with `{` or ` ``` ` (indicating a tool call in progress). Once the stream ends:
- If `parseToolCall()` succeeds → execute the tool, feed the result back as a new prompt turn
- If not a valid tool call but was suppressed → flush the text to the UI
- Max tool-call turns per message is configurable (`maxToolCalls`, default 3)

## Session State

Per-conversation state (not persisted across page reloads):

| Field | Description |
|---|---|
| `currentHeadphone` | Name of the headphone currently on the graph |
| `currentHeadphoneTraits` | Derived traits (neutral, bassy, bright, etc.) |
| `currentEQ` | Active PEQ filter array |
| `verifiedPhones` | Headphone names the model is allowed to mention |
| `userPreferences` | Inferred from conversation (likesBass, prefersNeutral, etc.) |
| `mode` | Discovery / Comparison / EQAdjustment / Explanation |

State is injected into every prompt turn so the model has context without needing a long conversation history.
