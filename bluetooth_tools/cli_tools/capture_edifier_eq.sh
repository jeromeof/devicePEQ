#!/bin/bash
# Quick capture script for Edifier W830NB EQ commands

echo "🎧 Edifier W830NB EQ Capture Tool"
echo "=================================="
echo ""

# Check if frida is available
if ! command -v frida &> /dev/null; then
    echo "❌ Error: frida not found"
    echo "Install with: pip install frida-tools"
    exit 1
fi

# Check if device is connected
if ! adb devices | grep -q "device$"; then
    echo "❌ Error: No Android device connected"
    echo "Connect device with USB debugging enabled"
    exit 1
fi

# Check if frida-server is running
echo "📱 Checking frida-server..."
if ! adb shell "ps -A | grep frida-server" &> /dev/null; then
    echo "⚠️  frida-server not running, attempting to start..."
    adb shell "su -c /data/local/tmp/frida-server &" &
    sleep 2
fi

# Find Edifier app
echo "🔍 Looking for Edifier app..."
PACKAGE=$(adb shell pm list packages | grep -i edifier | head -1 | cut -d: -f2 | tr -d '\r')

if [ -z "$PACKAGE" ]; then
    echo "❌ Error: Edifier app not found"
    echo "Install the Edifier ConnectX app first"
    exit 1
fi

echo "✅ Found package: $PACKAGE"
echo ""

# Create output file with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="edifier_eq_capture_${TIMESTAMP}.txt"

echo "📝 Output will be saved to: $OUTPUT_FILE"
echo ""
echo "================== INSTRUCTIONS =================="
echo "1. Make sure W830NB headphones are paired & connected"
echo "2. Open Edifier ConnectX app on your phone"
echo "3. Go to Custom EQ settings"
echo "4. Make ONE change at a time:"
echo "   - Change band 0 to 100Hz, +3dB"
echo "   - Wait 2 seconds"
echo "   - Change band 1 to 1000Hz, -3dB"
echo "   - Wait 2 seconds"
echo "5. Press Ctrl+C here when done"
echo "=================================================="
echo ""
echo "Starting capture in 5 seconds..."
sleep 5

# Start Frida
frida -U "$PACKAGE" -l frida_edifier.js --no-pause 2>&1 | tee "$OUTPUT_FILE"

echo ""
echo "✅ Capture saved to: $OUTPUT_FILE"
echo ""
echo "📊 Quick analysis:"
echo "   EQ write commands (0x44): $(grep -c 'Command.*0x44\|CUSTOM_EQ_SET_BAND' "$OUTPUT_FILE")"
echo "   Full profile (0x46): $(grep -c 'Command.*0x46\|CUSTOM_EQ_SET_FULL' "$OUTPUT_FILE")"
echo ""
echo "💡 To extract just EQ commands:"
echo "   grep -A 10 'CUSTOM_EQ' $OUTPUT_FILE > eq_commands_only.txt"
