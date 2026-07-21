#!/usr/bin/env python3
"""
Analyze the wave-like pattern with peak at ~75Hz and trough at ~175Hz
"""

import math

# Complete low-frequency data showing wave pattern
FREQ_DATA = [
    (50, 42391),
    (75, 42478),   # Peak
    (76, 42473),
    (77, 42472),
    (100, 42433),
    (150, 42291),
    (175, 42250),  # Trough
    (200, 42349),
]

print("=" * 70)
print("WAVE PATTERN ANALYSIS")
print("=" * 70)
print("\nData points:")
for freq, enc in FREQ_DATA:
    marker = ""
    if freq == 75:
        marker = "  ← PEAK"
    elif freq == 175:
        marker = "  ← TROUGH"
    print(f"  {freq:3d} Hz → {enc:5d}{marker}")

# Calculate amplitude and offset
peak = max(e for _, e in FREQ_DATA)
trough = min(e for _, e in FREQ_DATA)
amplitude = (peak - trough) / 2
offset = (peak + trough) / 2

print(f"\nWave characteristics:")
print(f"  Peak:      {peak} at ~75Hz")
print(f"  Trough:    {trough} at ~175Hz")
print(f"  Amplitude: {amplitude:.1f}")
print(f"  Offset:    {offset:.1f}")
print(f"  Period:    ~100Hz between peak and trough suggests ~200Hz full cycle")

print("\n" + "=" * 70)
print("TESTING SINE/COSINE WAVE MODELS")
print("=" * 70)

def test_wave_model(freq_data, wave_func, phase_shift_start=0, phase_shift_end=2*math.pi, steps=100):
    """Test sine or cosine wave model with phase shift sweep"""

    # Assume period around 200Hz (half period = 100Hz from peak to trough)
    # Angular frequency: ω = 2π/T = 2π/200
    angular_freq = 2 * math.pi / 200

    best_error = float('inf')
    best_phase = 0
    best_predictions = []

    # Sweep through phase shifts
    for i in range(steps):
        phase = phase_shift_start + (phase_shift_end - phase_shift_start) * i / steps

        errors = []
        predictions = []
        for freq, actual in freq_data:
            predicted = amplitude * wave_func(angular_freq * freq + phase) + offset
            predictions.append(predicted)
            error = abs(predicted - actual)
            errors.append(error)

        max_error = max(errors)
        if max_error < best_error:
            best_error = max_error
            best_phase = phase
            best_predictions = predictions

    return best_error, best_phase, best_predictions

# Test different wave models
models = [
    ("Sine", math.sin),
    ("Cosine", math.cos),
    ("Negative Sine", lambda x: -math.sin(x)),
    ("Negative Cosine", lambda x: -math.cos(x)),
]

results = []
for name, func in models:
    error, phase, predictions = test_wave_model(FREQ_DATA, func)
    results.append((name, error, phase, predictions))

# Sort by error
results.sort(key=lambda x: x[1])

print("\nBest fits (sorted by max error):")
for i, (name, error, phase, _) in enumerate(results[:4]):
    status = "✅" if error < 10 else ("✓" if error < 50 else "✗")
    print(f"{i+1}. {status} {name:20s} | Phase={phase:6.3f} rad | Max Error={error:6.1f}")

# Show detailed predictions for best model
best_name, best_error, best_phase, best_predictions = results[0]
print(f"\n{best_name} model with phase={best_phase:.3f} rad:")
print(f"Formula: encoded = {amplitude:.1f} * {best_name.lower()}(2πf/200 + {best_phase:.3f}) + {offset:.1f}")

print("\nDetailed predictions:")
for i, (freq, actual) in enumerate(FREQ_DATA):
    predicted = best_predictions[i]
    error = abs(predicted - actual)
    status = "✅" if error < 1 else ("✓" if error < 10 else "✗")
    print(f"  {status} {freq:3d} Hz: Pred={predicted:8.2f}, Actual={actual:5d}, Error={error:6.2f}")

print("\n" + "=" * 70)
print("TESTING WITH VARIABLE PERIOD")
print("=" * 70)

# Try different periods
best_overall_error = float('inf')
best_overall_period = 0
best_overall_model = None

for period in range(150, 301, 5):
    angular_freq = 2 * math.pi / period

    for name, func in models:
        errors = []
        for i in range(50):
            phase = 2 * math.pi * i / 50

            max_err = 0
            for freq, actual in FREQ_DATA:
                predicted = amplitude * func(angular_freq * freq + phase) + offset
                error = abs(predicted - actual)
                max_err = max(max_err, error)

            errors.append(max_err)

        min_error = min(errors)
        if min_error < best_overall_error:
            best_overall_error = min_error
            best_overall_period = period
            best_overall_model = name

print(f"\nBest overall fit:")
print(f"  Model:  {best_overall_model}")
print(f"  Period: {best_overall_period} Hz")
print(f"  Error:  {best_overall_error:.2f}")

if best_overall_error < 50:
    print(f"\n✅ Wave model fits reasonably well!")
else:
    print(f"\n❌ Wave model does not fit well - may be more complex")

print("\n" + "=" * 70)
print("CONCLUSION")
print("=" * 70)
print("The pattern shows wave-like behavior with:")
print(f"  - Peak at ~75Hz (value: {peak})")
print(f"  - Trough at ~175Hz (value: {trough})")
print(f"  - Amplitude: {amplitude:.1f}")
print("")
print("However, to fully decode this, we need more data points in other ranges,")
print("especially testing higher frequencies (500Hz-10kHz) to see if the pattern")
print("continues or changes.")
