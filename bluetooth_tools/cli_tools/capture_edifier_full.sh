#!/bin/bash
frida -U -l test_edifier_simple.js 25965 2>&1 | tee -a edifier_full_capture.txt &
FRIDA_PID=$!
echo "Frida PID: $FRIDA_PID"
echo ""
echo "=========================================="
echo "Capture is RUNNING"
echo "=========================================="
echo ""
echo "Please perform these actions in the app:"
echo "1. Change volume"
echo "2. Check battery"
echo "3. Switch EQ presets (2-3 different ones)"
echo "4. Open Custom EQ"
echo "5. Modify individual EQ bands"
echo "6. Save custom EQ"
echo ""
echo "Press Enter when done..."
read
kill $FRIDA_PID 2>/dev/null
echo "Capture stopped"
