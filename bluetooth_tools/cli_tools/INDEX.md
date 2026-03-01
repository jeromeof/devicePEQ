# 📚 Complete Index - Bluetooth Protocol Reverse Engineering Toolkit

## 🎯 Start Here

**New to this project?** Start with:
1. `README.md` - Project overview and Moondrop Edge ANC success story
2. `QUICK_REFERENCE.md` - Quick commands and cheat sheet
3. `README_TOOLS.md` - Detailed toolkit documentation

**Want to use the tools?**
→ Run `./bluetooth_toolkit.py` for interactive menu

**Already know what you want?**
→ See [Tool Reference](#-tool-reference) below

---

## 📁 File Organization

### 🎧 Moondrop Edge ANC (Completed Project)

| File | Description |
|------|-------------|
| `README.md` | Main project README - success story |
| `PROTOCOL_COMPLETE.md` | 100% decoded protocol specification |
| `GAIN_DECODED.md` | Gain encoding discovery story |
| `WEB_SERIAL_SUCCESS.md` | Browser-based control implementation |
| `moondrop_web_serial.html` | ⭐ **Working web interface** |
| `moondrop_spp_cli.py` | Command-line interface |
| `verify_gain_formula.py` | Formula verification script |
| `decode_analysis.md` | Technical analysis notes |
| `SETUP_GUIDE.md` | Complete setup guide |

### 🛠️ Universal Toolkit (Reusable Tools)

| File | Description |
|------|-------------|
| `README_TOOLS.md` | **Comprehensive toolkit docs** |
| `QUICK_REFERENCE.md` | **Quick command reference** |
| `bluetooth_toolkit.py` | ⭐ **Interactive menu** (START HERE) |
| `scan_ble.py` | BLE device scanner |
| `capture_bluetooth.py` | Protocol capture tool |
| `frida_bluetooth_universal.js` | Universal Frida script |
| `frida_flutter_eq.js` | Flutter-specific script |
| `frida_airoha.js` | Airoha chipset script |

### 📖 Documentation

| File | Description |
|------|-------------|
| `INDEX.md` | This file - complete file index |
| `QUICK_REFERENCE.md` | Commands and cheat sheet |
| `README_TOOLS.md` | Full toolkit documentation |
| `NEED_MORE_DATA.md` | Data collection guide |

### 🔬 Analysis & Verification

| File | Description |
|------|-------------|
| `gain_decoder.py` | Automatic formula testing |
| `verify_gain_formula.py` | Moondrop formula verification |
| `decode_analysis.md` | Analysis notes |

### 🗄️ Legacy/Archive

| File | Description |
|------|-------------|
| `moondrop_web_bluetooth.html` | BLE GATT attempt (doesn't work) |
| `moondrop_web_interface.html` | WebSocket bridge GUI |
| `moondrop_web_server.py` | WebSocket server |
| `frida_spp_socket.js` | Original SPP discovery script |
| `frida_full_capture.js` | Full EQ capture script |
| Various other experimental scripts | ... |

---

## 🚀 Tool Reference

### 1. Interactive Menu (Easiest!)

```bash
./bluetooth_toolkit.py
```

Choose from menu:
1. Scan BLE Devices
2. Analyze Device
3. Capture Protocol (Universal)
4. Capture Protocol (Flutter)
5. Capture Protocol (Airoha)
6. List Android Apps

### 2. BLE Scanner

```bash
# Basic usage
./scan_ble.py

# With options
./scan_ble.py --name "Device" --analyze "Device" --export results.txt

# Full help
./scan_ble.py --help
```

**See**: `README_TOOLS.md` for detailed documentation

### 3. Protocol Capture

```bash
# Basic usage
./capture_bluetooth.py com.app.package

# With options
./capture_bluetooth.py com.app.package --airoha --output capture.log

# Full help
./capture_bluetooth.py --help
```

**See**: `README_TOOLS.md` for detailed documentation

### 4. Frida Scripts (Advanced)

```bash
# Direct frida usage
frida -U -f com.app.package -l frida_bluetooth_universal.js

# Choose script based on app/device:
# - frida_bluetooth_universal.js → Most devices
# - frida_flutter_eq.js → Flutter apps
# - frida_airoha.js → Airoha chipset
```

**See**: Comments in each `.js` file for details

---

## 📖 Documentation Index

### Getting Started Docs

1. **Complete Beginner**
   - Start: `README.md` (motivating success story)
   - Then: `QUICK_REFERENCE.md` (practical commands)
   - Finally: `README_TOOLS.md` (comprehensive guide)

2. **Want to Decode Your Device**
   - Read: `README_TOOLS.md` → "Analysis Workflow" section
   - Use: `./bluetooth_toolkit.py` for guided process
   - Reference: `QUICK_REFERENCE.md` while working

3. **Want to Use Moondrop Tools**
   - Read: `WEB_SERIAL_SUCCESS.md`
   - Use: `moondrop_web_serial.html` (open in Chrome)
   - Advanced: `moondrop_spp_cli.py` for command line

### Technical Docs

1. **Protocol Specifications**
   - Moondrop: `PROTOCOL_COMPLETE.md`
   - Discovery: `GAIN_DECODED.md`
   - Analysis: `decode_analysis.md`

2. **Implementation Details**
   - Web Interface: `WEB_SERIAL_SUCCESS.md`
   - CLI Tool: Comments in `moondrop_spp_cli.py`
   - Verification: `verify_gain_formula.py`

3. **Toolkit Internals**
   - Full guide: `README_TOOLS.md`
   - Quick ref: `QUICK_REFERENCE.md`
   - Scripts: Comments in `.py` and `.js` files

---

## 🎯 Use Cases → Recommended Path

### "I want to control my Moondrop Edge ANC from Chrome"

```bash
# Just open this file:
open moondrop_web_serial.html

# Or use CLI:
python3 moondrop_spp_cli.py scan
python3 moondrop_spp_cli.py enable AA:BB:CC:DD:EE:FF
```

**Docs**: `WEB_SERIAL_SUCCESS.md`, `SETUP_GUIDE.md`

### "I want to decode my own Bluetooth device"

```bash
# Interactive workflow:
./bluetooth_toolkit.py

# Or manual:
./scan_ble.py --analyze "MyDevice"
./capture_bluetooth.py com.mydevice.app
```

**Docs**: `README_TOOLS.md` → "Analysis Workflow"

### "I'm developing a Flutter audio app"

```bash
# Use Flutter-specific capture:
./capture_bluetooth.py com.myapp --script frida_flutter_eq.js
```

**Docs**: `README_TOOLS.md` → "Tips for Flutter Apps"

### "I have an Airoha chipset device"

```bash
# Use Airoha-specific capture:
./capture_bluetooth.py com.app --airoha
```

**Docs**: `README_TOOLS.md` → "Tips for Airoha Devices"

### "I want to learn protocol reverse engineering"

**Study this case**: Moondrop Edge ANC

1. Read: `README.md` (what we achieved)
2. Read: `GAIN_DECODED.md` (the discovery process)
3. Read: `PROTOCOL_COMPLETE.md` (final result)
4. Study: `frida_spp_socket.js` (the key script)
5. Practice: Use toolkit on your own device!

---

## 🏆 Success Metrics

### Moondrop Edge ANC Project

- **Time invested**: ~3 hours total
- **Tools used**: Frida, bleak, Web Serial API
- **Key breakthrough**: User observation → shifted gain encoding
- **Result**: 100% protocol decoded
- **Deliverables**:
  - Working web interface (no backend!)
  - CLI tool
  - Complete documentation
  - Reusable toolkit

### Your Project

Use this template to document your success:
- Device name: _______________
- Time invested: _______________
- Protocol discovered: _______________
- Tools used: _______________
- Key challenges: _______________
- Result: _______________
- Share your findings! 🎉

---

## 🤝 Contributing

### Found a bug?
Open an issue or fix it and share!

### Decoded a new device?
Add your protocol to the documentation!

### Improved a tool?
Submit your enhancement!

### Want to help?
- Test tools on different devices
- Improve documentation
- Add more protocol patterns
- Create video tutorials

---

## 📜 License & Disclaimer

**License**: Open source for the community

**Disclaimer**: Educational and interoperability purposes only. Not affiliated with device manufacturers. Use responsibly on devices you own.

---

## 🔗 Quick Links

### Most Useful Files

- **Start here**: `./bluetooth_toolkit.py`
- **Quick ref**: `QUICK_REFERENCE.md`
- **Full docs**: `README_TOOLS.md`
- **Success story**: `README.md`
- **Moondrop web UI**: `moondrop_web_serial.html`

### External Resources

- Frida: https://frida.re/
- Frida releases: https://github.com/frida/frida/releases
- Bleak (Python BLE): https://github.com/hbldh/bleak
- Web Serial API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API

---

**Last Updated**: 2026-01-25

**Version**: 1.0

**Status**: Production Ready ✅

---

*Remember: Every proprietary protocol can be reverse engineered with patience, systematic testing, and the right tools!* 🔍🎧✨
