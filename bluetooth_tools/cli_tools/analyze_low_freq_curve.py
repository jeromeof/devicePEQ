#!/usr/bin/env python3
"""
Analyze the 50-77Hz range with dense data points to find the encoding curve
"""

import math

# Dense low-frequency data
LOW_FREQ_DATA = [
    (50, 42391),
    (75, 42478),
    (76, 42473),
    (77, 42472),
    (100, 42433),
    (150, 42291),
    (200, 42349),
]

print("=" * 70)
print("LOW FREQUENCY CURVE ANALYSIS (50-200 Hz)")
print("=" * 70)
print("\nData points:")
for freq, enc in LOW_FREQ_DATA:
    print(f"  {freq:3d} Hz → {enc:5d}")

print("\n" + "=" * 70)
print("RATE OF CHANGE ANALYSIS")
print("=" * 70)
print("\nLooking at derivatives (change per Hz):")
for i in range(len(LOW_FREQ_DATA) - 1):
    f1, e1 = LOW_FREQ_DATA[i]
    f2, e2 = LOW_FREQ_DATA[i + 1]
    delta_f = f2 - f1
    delta_e = e2 - e1
    rate = delta_e / delta_f
    print(f"  {f1:3d} → {f2:3d} Hz: Δ={delta_e:+5d}, Rate={rate:+7.2f} per Hz")

print("\n" + "=" * 70)
print("TESTING BIQUAD COEFFICIENT WITH FINE TUNING")
print("=" * 70)

# For a biquad filter: encoded = scale * cos(2πf/Fs) + offset
# Let's try to find the best sample rate by testing a range

def test_biquad_fit(sample_rate, freq_data):
    """Test biquad coefficient fit with given sample rate"""
    freqs = [f for f, _ in freq_data]
    encoded = [e for _, e in freq_data]

    # Use first two points to solve for scale and offset
    f1, e1 = freq_data[0]
    f2, e2 = freq_data[1]

    cos_w1 = math.cos(2 * math.pi * f1 / sample_rate)
    cos_w2 = math.cos(2 * math.pi * f2 / sample_rate)

    if abs(cos_w2 - cos_w1) < 0.0001:
        return None, float('inf')

    scale = (e2 - e1) / (cos_w2 - cos_w1)
    offset = e1 - scale * cos_w1

    # Calculate errors
    errors = []
    for freq, actual in freq_data:
        cos_w = math.cos(2 * math.pi * freq / sample_rate)
        predicted = scale * cos_w + offset
        error = abs(predicted - actual)
        errors.append(error)

    max_error = max(errors)
    avg_error = sum(errors) / len(errors)

    return (scale, offset, max_error, avg_error), errors

# Test a range of sample rates
print("\nTesting sample rates from 20kHz to 100kHz:")
best_sr = None
best_max_error = float('inf')
best_params = None

for sr in range(20000, 100001, 1000):
    result = test_biquad_fit(sr, LOW_FREQ_DATA)
    if result[0] is None:
        continue

    params, errors = result
    scale, offset, max_error, avg_error = params

    if max_error < best_max_error:
        best_max_error = max_error
        best_sr = sr
        best_params = params
        best_errors = errors

if best_sr:
    scale, offset, max_error, avg_error = best_params
    print(f"\n✅ Best fit at {best_sr}Hz sample rate:")
    print(f"   Formula: encoded = {scale:.2f} * cos(2πf/{best_sr}) + {offset:.2f}")
    print(f"   Max error: {max_error:.1f}")
    print(f"   Avg error: {avg_error:.1f}")

    print("\n   Predictions:")
    for i, (freq, actual) in enumerate(LOW_FREQ_DATA):
        cos_w = math.cos(2 * math.pi * freq / best_sr)
        predicted = scale * cos_w + offset
        error = best_errors[i]
        status = "✓" if error < 10 else "✗"
        print(f"   {status} {freq:3d} Hz: cos(ω)={cos_w:7.5f}, Pred={predicted:8.1f}, Actual={actual:5d}, Err={error:5.1f}")

# Now test with finer granularity around the best
print(f"\n   Fine-tuning around {best_sr}Hz...")
for sr in range(best_sr - 500, best_sr + 501, 10):
    result = test_biquad_fit(sr, LOW_FREQ_DATA)
    if result[0] is None:
        continue

    params, errors = result
    scale, offset, max_error, avg_error = params

    if max_error < best_max_error:
        best_max_error = max_error
        best_sr = sr
        best_params = params
        best_errors = errors

if best_sr:
    scale, offset, max_error, avg_error = best_params
    print(f"\n🎯 BEST FIT at {best_sr}Hz sample rate:")
    print(f"   Formula: encoded = {scale:.2f} * cos(2πf/{best_sr}) + {offset:.2f}")
    print(f"   Max error: {max_error:.2f}")
    print(f"   Avg error: {avg_error:.2f}")

    print("\n   Detailed predictions:")
    for i, (freq, actual) in enumerate(LOW_FREQ_DATA):
        cos_w = math.cos(2 * math.pi * freq / best_sr)
        predicted = scale * cos_w + offset
        error = best_errors[i]
        status = "✅" if error < 1 else ("✓" if error < 10 else "✗")
        print(f"   {status} {freq:3d} Hz: cos(ω)={cos_w:7.5f}, Pred={predicted:8.2f}, Actual={actual:5d}, Err={error:5.2f}")

print("\n" + "=" * 70)
print("CONCLUSION")
print("=" * 70)
if best_max_error < 10:
    print(f"✅ Found excellent fit! Max error: {best_max_error:.2f}")
    print(f"   Sample rate: {best_sr}Hz")
    print(f"   The encoding IS a biquad coefficient!")
else:
    print(f"❌ Best fit has max error: {best_max_error:.2f}")
    print(f"   May need more complex model or higher frequencies to determine pattern")
