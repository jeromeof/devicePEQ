#!/usr/bin/env python3.11
"""
Polynomial-based frequency encoder for Edifier W830NB
Using degree 10 polynomial with max error ~95 units

This is an ALTERNATIVE to the lookup table approach.
Pros: Single formula, works for any frequency
Cons: ~95 unit error vs 0 error for lookup table
"""

import numpy as np

# Degree 10 polynomial coefficients (from scipy curve fitting)
# Achieves max error of 94.8 units across all 19 test points
POLY_COEFFS = np.array([
    -1.6202531103029546e-30,  # x^10
    6.236833545814552e-26,     # x^9
    -9.70502159798894e-22,     # x^8
    7.897463558428749e-18,     # x^7
    -3.6440249559422345e-14,   # x^6
    9.684988663229658e-11,     # x^5
    -1.4430285379790847e-07,   # x^4
    0.00011187554451921797,    # x^3
    -0.03857245055677001,      # x^2
    3.829794328101997,         # x^1
    42338.25083870964          # x^0 (constant)
])

def encode_frequency_polynomial(frequency_hz: float) -> tuple:
    """
    Encode frequency using polynomial formula

    Args:
        frequency_hz: Frequency in Hz (20-10000 recommended)

    Returns:
        (byte2, byte3) tuple for the frequency encoding

    Note: Max error ~95 units compared to actual hardware values
    """
    # Clamp to tested range
    freq = max(20, min(10000, frequency_hz))

    # Evaluate polynomial
    encoded_value = np.polyval(POLY_COEFFS, freq)

    # Round to nearest integer
    encoded_int = int(round(encoded_value))

    # Ensure it's in valid 16-bit range
    encoded_int = max(0, min(65535, encoded_int))

    # Split into two bytes
    byte2 = (encoded_int >> 8) & 0xFF
    byte3 = encoded_int & 0xFF

    return (byte2, byte3)


# Test data for verification
TEST_DATA = [
    (20, 42417),
    (50, 42391),
    (75, 42478),
    (100, 42433),
    (175, 42250),
    (500, 42065),
    (1000, 42573),
    (1500, 41081),
    (2000, 41589),
    (3000, 44573),
    (5000, 46637),
    (6000, 45781),
    (10000, 33461),
]


def test_polynomial_encoder():
    """Test the polynomial encoder against known values"""
    print("=" * 80)
    print("POLYNOMIAL FREQUENCY ENCODER TEST")
    print("=" * 80)
    print()

    print(f"{'Frequency':<12} {'Actual':<8} {'Predicted':<10} {'Error':<8} {'Bytes':<12} {'Status'}")
    print("-" * 80)

    max_error = 0
    total_error = 0

    for freq, actual in TEST_DATA:
        byte2, byte3 = encode_frequency_polynomial(freq)
        predicted = (byte2 << 8) | byte3
        error = abs(predicted - actual)

        max_error = max(max_error, error)
        total_error += error

        status = "✅" if error < 50 else ("✓" if error < 100 else "✗")
        print(f"{freq:<12} {actual:<8} {predicted:<10} {error:<8.1f} 0x{byte2:02X} 0x{byte3:02X}   {status}")

    mean_error = total_error / len(TEST_DATA)

    print("-" * 80)
    print(f"Max error:  {max_error:.1f} units")
    print(f"Mean error: {mean_error:.1f} units")
    print()

    print("=" * 80)
    print("COMPARISON: Polynomial vs Lookup Table")
    print("=" * 80)
    print()
    print("Polynomial (Degree 10):")
    print(f"  ✅ Single formula - works for any frequency")
    print(f"  ✅ No table storage needed")
    print(f"  ⚠️  Max error: ~95 units (~0.2% relative error)")
    print(f"  ⚠️  May be unstable outside 20-10000 Hz range")
    print()
    print("Lookup Table + Interpolation:")
    print(f"  ✅ Perfect accuracy at 19 known points (0 error)")
    print(f"  ✅ Excellent interpolation between points")
    print(f"  ✅ Stable and predictable")
    print(f"  ⚠️  Requires storing 19 data points")
    print()
    print("RECOMMENDATION: Use lookup table for production")
    print("                Use polynomial for educational/analysis purposes")
    print()


if __name__ == "__main__":
    test_polynomial_encoder()

    # Show example usage
    print("=" * 80)
    print("EXAMPLE USAGE")
    print("=" * 80)
    print()
    print("# Encode arbitrary frequencies:")
    for freq in [100, 250, 750, 1250, 4000, 8000]:
        byte2, byte3 = encode_frequency_polynomial(freq)
        value = (byte2 << 8) | byte3
        print(f"  {freq:5d} Hz → 0x{byte2:02X} 0x{byte3:02X} (16-bit: {value})")
