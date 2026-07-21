# Edifier W830NB - Frequency Encoding Lookup Table

## Verified Frequency Mappings

| Frequency (Hz) | Byte 2 (hex) | Byte 3 (hex) | Byte 2 (dec) | Byte 3 (dec) | 16-bit Value |
|----------------|--------------|--------------|--------------|--------------|--------------|
| 50             | 0xA5         | 0x97         | 165          | 151          | 42391        |
| 100            | 0xA5         | 0xC1         | 165          | 193          | 42433        |
| 150            | 0xA5         | 0x33         | 165          | 51           | 42291        |
| 200            | 0xA5         | 0x6D         | 165          | 109          | 42349        |
| 500            | 0xA4         | 0x51         | 164          | 81           | 42065        |
| 1000           | 0xA6         | 0x4D         | 166          | 77           | 42573        |
| 2000           | 0xA2         | 0x75         | 162          | 117          | 41589        |
| 3000           | 0xAE         | 0x1D         | 174          | 29           | 44573        |
| 3078           | 0xA9         | 0xA3         | 169          | 163          | 43427        |
| 10000          | 0x82         | 0xB5         | 130          | 181          | 33461        |

---

## Analysis

### Pattern Observations

1. **Low frequencies (50-200 Hz):** Byte 2 stays constant at 0xA5 (165)
2. **Mid frequencies (500-3000 Hz):** Byte 2 varies: 164-174
3. **High frequencies (10000 Hz):** Byte 2 drops to 130
4. **No linear relationship:** The encoding is non-linear and complex

### Encoding Hypothesis

The encoding could be one of:

#### 1. Fixed-Point Biquad Coefficient
Biquad filters use `cos(ω)` where `ω = 2πf/Fs`. The values might be:
```
encoded = scale * cos(2π * f / sample_rate) + offset
```

Testing with 48kHz sample rate shows correlation but not exact match.

#### 2. Lookup Table
The DSP chip may use a pre-computed lookup table for common frequencies, with interpolation between entries.

#### 3. Proprietary Format
The encoding may be specific to the audio DSP chip used (likely a Chinese manufacturer's custom format).

---

## Reverse Lookup Table

For decoding (16-bit value → frequency):

```javascript
const frequencyLookup = {
    42391: 50,
    42433: 100,
    42291: 150,
    42349: 200,
    42065: 500,
    42573: 1000,
    41589: 2000,
    44573: 3000,
    43427: 3078,
    33461: 10000
};
```

For encoding (frequency → bytes), use the table above or implement nearest-neighbor search.

---

## Implementation Notes

### Encoding Function (Pseudo-code)

```javascript
function encodeFrequency(frequencyHz) {
    // Use lookup table for known frequencies
    const lookup = {
        50: [0xA5, 0x97],
        100: [0xA5, 0xC1],
        150: [0xA5, 0x33],
        200: [0xA5, 0x6D],
        500: [0xA4, 0x51],
        1000: [0xA6, 0x4D],
        2000: [0xA2, 0x75],
        3000: [0xAE, 0x1D],
        3078: [0xA9, 0xA3],
        10000: [0x82, 0xB5]
    };

    if (lookup[frequencyHz]) {
        return lookup[frequencyHz];
    }

    // For interpolation, find nearest neighbors
    // TODO: Implement interpolation algorithm

    throw new Error(`Unknown frequency: ${frequencyHz} Hz`);
}
```

### Decoding Function (Pseudo-code)

```javascript
function decodeFrequency(byte2, byte3) {
    const combined = (byte2 << 8) | byte3;

    const lookup = {
        42391: 50,
        42433: 100,
        42291: 150,
        42349: 200,
        42065: 500,
        42573: 1000,
        41589: 2000,
        44573: 3000,
        43427: 3078,
        33461: 10000
    };

    if (lookup[combined]) {
        return lookup[combined];
    }

    // Find nearest match
    let closestValue = null;
    let minDiff = Infinity;

    for (const [encoded, freq] of Object.entries(lookup)) {
        const diff = Math.abs(encoded - combined);
        if (diff < minDiff) {
            minDiff = diff;
            closestValue = freq;
        }
    }

    return closestValue;
}
```

---

## Next Steps

### To Decode the Formula:

1. **Test more frequencies** to fill in gaps:
   - 75, 125, 175 Hz (low range)
   - 250, 300, 400, 600, 800 Hz (mid-low range)
   - 1500, 2500, 3500, 4000 Hz (mid range)
   - 5000, 6000, 7000, 8000, 15000, 20000 Hz (high range)

2. **Investigate DSP chip:** Find out which audio DSP is used in the W830NB
   - Check teardown photos
   - Analyze firmware binary
   - Contact manufacturer

3. **Mathematical curve fitting:** Use collected data points to fit a curve:
   - Polynomial regression
   - Logarithmic/exponential fitting
   - Trigonometric approximation

4. **Decompile app:** Reverse engineer the Android app to find the encoding function

---

## Usage in Code

For now, use the lookup table for known frequencies. For arbitrary frequencies:

1. **Option A:** Find nearest frequency in table
2. **Option B:** Interpolate between two closest known frequencies
3. **Option C:** Limit UI to only supported frequencies (like the app does)

---

## Testing Protocol

To gather more data:

```bash
# Start capture
python3 bluetooth_toolkit.py capture <package> --edifier

# In app: Change filter frequency to target Hz
# Observe SET_BAND command payload bytes 2-3
# Add to lookup table
```

**Target frequencies for next session:**
- 75, 125, 250, 400, 800, 1500, 4000, 5000, 8000, 15000, 20000 Hz
