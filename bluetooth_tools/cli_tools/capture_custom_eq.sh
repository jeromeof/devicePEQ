#!/bin/bash
echo "🎧 Edifier W830NB - Custom EQ Capture Session"
echo "=============================================="
echo ""
frida -U -l test_edifier_simple.js 26796 2>&1 | tee edifier_custom_eq_capture.txt &
FRIDA_PID=$!
sleep 2
echo ""
echo "✅ Capture is RUNNING"
echo ""
echo "📋 ACTIONS TO PERFORM (in order):"
echo ""
echo "1️⃣  Open Custom EQ page in the app"
echo "    (This should trigger a 0x43 command - get all EQ bands)"
echo ""
echo "2️⃣  Modify ONE EQ band (e.g., 100Hz or 1kHz)"
echo "    - Move the slider up or down"
echo "    (This should trigger a 0x44 command - set single band)"
echo ""
echo "3️⃣  Modify ANOTHER EQ band"
echo "    - Pick a different frequency"
echo "    - Move the slider"
echo ""
echo "4️⃣  (Optional) Change volume slider"
echo ""
echo "5️⃣  (Optional) Check battery status"
echo ""
echo "=============================================="
echo "Press Enter when you're done with all actions..."
echo "=============================================="
echo ""
read
kill $FRIDA_PID 2>/dev/null
wait $FRIDA_PID 2>/dev/null
echo ""
echo "✅ Capture stopped!"
echo ""
echo "📊 Analyzing captured data..."
echo ""
