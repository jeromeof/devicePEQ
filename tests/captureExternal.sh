#!/usr/bin/env bash
# captureExternal.sh — capture USB HID traffic on any website using Chrome CDP
#
# Usage:
#   ./tests/captureExternal.sh <url> <output-name>
#
# Examples:
#   ./tests/captureExternal.sh https://peq.szwalkplay.com/ walkplay_my_device
#   ./tests/captureExternal.sh https://fiiocontrol.fiio.com/ fiio_my_device
#   ./tests/captureExternal.sh https://hub.moondroplab.tech/ moondrop_my_device
#
# The capture JSON lands in tests/captures/external/<output-name>.json
#
# Prerequisites:
#   1. Chrome running with: --remote-debugging-port=9222
#      (the no-cache server is NOT needed for external sites)
#   2. If the site requires login, open the URL manually in Chrome first and log in,
#      then run this script — it will inject into your existing logged-in tab.
#
# The script:
#   1. Opens (or finds) the target URL in Chrome
#   2. Injects captureHelper.js which patches navigator.hid
#   3. Waits for you to connect your device on the website and perform actions
#   4. On Enter: stops the capture and saves the JSON

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE=$(ls ~/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)
if [[ -z "$NODE" ]]; then
  echo "ERROR: Node.js not found via nvm. Install Node.js or set NODE env var."
  exit 1
fi

URL="${1:-}"
NAME="${2:-}"

if [[ -z "$URL" || -z "$NAME" ]]; then
  echo "Usage: $0 <url> <output-name>"
  echo "  e.g. $0 https://peq.szwalkplay.com/ walkplay_my_device"
  exit 1
fi

OUT_FILE="$SCRIPT_DIR/captures/external/${NAME}.json"
TAB_SUB=$(echo "$URL" | sed 's|https\?://||' | cut -d'/' -f1)

# Ensure Chrome is running with remote debugging
if ! curl -s --max-time 2 http://localhost:9222/json > /dev/null 2>&1; then
  echo "Chrome is not running with --remote-debugging-port=9222."
  echo "Start Chrome first:"
  echo "  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\"
  echo "    --remote-debugging-port=9222 \\"
  echo "    --user-data-dir=/tmp/devpeq-chrome-capture \\"
  echo "    '$URL'"
  exit 1
fi

# Check if tab is already open; if not, open it
echo "Looking for tab matching: $TAB_SUB"
if $NODE "$SCRIPT_DIR/cdp.mjs" find --tab "$TAB_SUB" > /dev/null 2>&1; then
  echo "Found existing tab."
else
  echo "Opening new tab at: $URL"
  $NODE "$SCRIPT_DIR/cdp.mjs" open "$URL"
  echo "Waiting for page to load..."
  sleep 3
fi

# Kill any existing daemon
touch "$SCRIPT_DIR/.cdp-stop" 2>/dev/null || true
sleep 1.2
rm -f "$SCRIPT_DIR/.cdp-stop" \
      "$SCRIPT_DIR/.cdp-daemon.pid" \
      "$SCRIPT_DIR/.capture-result.json"

# Start daemon targeting the external tab
echo ""
echo "Starting capture daemon on tab: $TAB_SUB"
nohup $NODE "$SCRIPT_DIR/cdp.mjs" inject --tab "$TAB_SUB" \
  > /tmp/cdp-external-daemon.log 2>&1 &
DPID=$!
sleep 4

if ! ps -p $DPID > /dev/null 2>&1; then
  echo "ERROR: Daemon failed to start. Log:"
  cat /tmp/cdp-external-daemon.log
  exit 1
fi

# Verify injection
READY=$($NODE "$SCRIPT_DIR/cdp.mjs" eval \
  "JSON.stringify({ready: window.__captureHelperReady, hidPatched: !!navigator.hid.__captureHelperInstalled})" \
  --tab "$TAB_SUB" 2>&1)
echo "Injection status: $READY"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Capture daemon is running on: $URL"
echo ""
echo "  1. Connect your device on the website"
echo "  2. Perform all the actions you want to capture"
echo "     (mic volume, DAC filter changes, etc.)"
echo "  3. Press ENTER here when done"
echo "═══════════════════════════════════════════════════════════"
read -r _

# Stop and save
echo "Stopping capture..."
$NODE "$SCRIPT_DIR/cdp.mjs" stop --tab "$TAB_SUB" --out "$OUT_FILE"

echo ""
echo "✓ Capture saved to: $OUT_FILE"
echo ""
echo "To inspect:"
echo "  cat '$OUT_FILE' | python3 -m json.tool | head -80"
