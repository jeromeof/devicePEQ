#!/usr/bin/env python3
"""
Attempt to find a mathematical formula for Edifier W830NB frequency encoding
"""

import math

# Known frequency mappings
FREQ_DATA = [
    (50, 0xA5, 0x97, 42391),
    (75, 0xA5, 0xEE, 42478),  # ✅ NEW!
    (76, 0xA5, 0xE9, 42473),  # ✅ NEW!
    (77, 0xA5, 0xE8, 42472),  # ✅ NEW!
    (100, 0xA5, 0xC1, 42433),
    (150, 0xA5, 0x33, 42291),
    (200, 0xA5, 0x6D, 42349),
    (500, 0xA4, 0x51, 42065),
    (1000, 0xA6, 0x4D, 42573),
    (2000, 0xA2, 0x75, 41589),
    (3000, 0xAE, 0x1D, 44573),
    (3078, 0xA9, 0xA3, 43427),
    (10000, 0x82, 0xB5, 33461),
]

def test_linear():
    """Test if encoding is linear"""
    print("=" * 70)
    print("Testing Linear Relationship: encoded = a*freq + b")
    print("=" * 70)

    # Use first two points to solve for a and b
    f1, _, _, e1 = FREQ_DATA[0]
    f2, _, _, e2 = FREQ_DATA[1]

    a = (e2 - e1) / (f2 - f1)
    b = e1 - a * f1

    print(f"Calculated: a = {a:.4f}, b = {b:.2f}")
    print(f"Formula: encoded = {a:.4f} * freq + {b:.2f}\n")

    print("Testing against all points:")
    for freq, b2, b3, actual in FREQ_DATA:
        predicted = a * freq + b
        error = abs(predicted - actual)
        print(f"  {freq:5d} Hz: Predicted={predicted:8.1f}, Actual={actual:5d}, Error={error:8.1f}")
    print()

def test_logarithmic():
    """Test if encoding is logarithmic"""
    print("=" * 70)
    print("Testing Logarithmic: encoded = a*log(freq) + b")
    print("=" * 70)

    f1, _, _, e1 = FREQ_DATA[0]
    f2, _, _, e2 = FREQ_DATA[1]

    a = (e2 - e1) / (math.log(f2) - math.log(f1))
    b = e1 - a * math.log(f1)

    print(f"Calculated: a = {a:.4f}, b = {b:.2f}")
    print(f"Formula: encoded = {a:.4f} * log(freq) + {b:.2f}\n")

    print("Testing against all points:")
    for freq, b2, b3, actual in FREQ_DATA:
        predicted = a * math.log(freq) + b
        error = abs(predicted - actual)
        print(f"  {freq:5d} Hz: Predicted={predicted:8.1f}, Actual={actual:5d}, Error={error:8.1f}")
    print()

def test_biquad_coefficient(sample_rate):
    """Test if encoding is based on biquad cos(ω) coefficient"""
    print("=" * 70)
    print(f"Testing Biquad Coefficient: cos(2πf/Fs) where Fs={sample_rate}Hz")
    print("=" * 70)

    # Calculate cos(ω) for first two points
    f1, _, _, e1 = FREQ_DATA[0]
    f2, _, _, e2 = FREQ_DATA[1]

    cos_w1 = math.cos(2 * math.pi * f1 / sample_rate)
    cos_w2 = math.cos(2 * math.pi * f2 / sample_rate)

    # Solve for scale and offset: encoded = scale * cos(ω) + offset
    scale = (e2 - e1) / (cos_w2 - cos_w1)
    offset = e1 - scale * cos_w1

    print(f"Calculated: scale = {scale:.2f}, offset = {offset:.2f}")
    print(f"Formula: encoded = {scale:.2f} * cos(2πf/{sample_rate}) + {offset:.2f}\n")

    print("Testing against all points:")
    max_error = 0
    for freq, b2, b3, actual in FREQ_DATA:
        cos_w = math.cos(2 * math.pi * freq / sample_rate)
        predicted = scale * cos_w + offset
        error = abs(predicted - actual)
        max_error = max(max_error, error)
        status = "✓" if error < 100 else "✗"
        print(f"  {status} {freq:5d} Hz: cos(ω)={cos_w:7.4f}, Predicted={predicted:8.1f}, Actual={actual:5d}, Error={error:8.1f}")

    print(f"\nMax error: {max_error:.1f}")
    return max_error

def test_inverse():
    """Test if encoding is inverse relationship"""
    print("=" * 70)
    print("Testing Inverse: encoded = a/freq + b")
    print("=" * 70)

    f1, _, _, e1 = FREQ_DATA[0]
    f2, _, _, e2 = FREQ_DATA[1]

    a = (e2 - e1) / (1/f2 - 1/f1)
    b = e1 - a / f1

    print(f"Calculated: a = {a:.2f}, b = {b:.2f}")
    print(f"Formula: encoded = {a:.2f} / freq + {b:.2f}\n")

    print("Testing against all points:")
    for freq, b2, b3, actual in FREQ_DATA:
        predicted = a / freq + b
        error = abs(predicted - actual)
        print(f"  {freq:5d} Hz: Predicted={predicted:8.1f}, Actual={actual:5d}, Error={error:8.1f}")
    print()

if __name__ == "__main__":
    print("\n🔬 EDIFIER W830NB FREQUENCY ENCODING ANALYSIS")
    print("Attempting to find mathematical formula...\n")

    # Test different hypotheses
    test_linear()
    test_logarithmic()
    test_inverse()

    # Test biquad coefficients with common sample rates
    print("\n" + "=" * 70)
    print("BIQUAD COEFFICIENT TESTING (multiple sample rates)")
    print("=" * 70)
    print()

    sample_rates = [44100, 48000, 32000, 96000, 24000]
    best_sr = None
    best_error = float('inf')

    for sr in sample_rates:
        error = test_biquad_coefficient(sr)
        print()
        if error < best_error:
            best_error = error
            best_sr = sr

    print("=" * 70)
    print("CONCLUSION")
    print("=" * 70)
    if best_error < 100:
        print(f"✅ POSSIBLE MATCH: Biquad coefficient at {best_sr}Hz")
        print(f"   Max error: {best_error:.1f} (acceptable)")
    else:
        print(f"❌ NO SIMPLE FORMULA FOUND")
        print(f"   Best attempt: Biquad at {best_sr}Hz with error={best_error:.1f}")
        print(f"   Recommendation: Use lookup table")
    print("=" * 70)
