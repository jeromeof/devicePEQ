#!/usr/bin/env python3
"""
Earfun Tune Pro CRC Reverse Engineering
Tries various CRC-8 polynomials to find the correct one
"""

def crc8(data, poly, init=0x00, xor_out=0x00):
    """Calculate CRC-8 with given polynomial"""
    crc = init
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ poly) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc ^ xor_out

# Common CRC-8 polynomials
POLYNOMIALS = {
    "CRC-8": 0x07,
    "CRC-8-CCITT": 0x07,
    "CRC-8-DALLAS-MAXIM": 0x31,
    "CRC-8-SAE-J1850": 0x1D,
    "CRC-8-WCDMA": 0x9B,
    "CRC-8-ITU": 0x07,
    "CRC-8-ROHC": 0x07,
    "CRC-8-DARC": 0x39,
    "CRC-8-DVB-S2": 0xD5,
    "CRC-8-EBU": 0x1D,
    "CRC-8-AUTOSAR": 0x2F,
}

# Test data from captured commands
test_commands = [
    ("EF 20 95 0A 0A 01 FC F4 00 5E 01 2C 0B 33", 0xCE),
    ("EF 20 95 0A 0A 02 FC F4 00 BD 00 00 0B 33", 0x01),
    ("EF 20 95 0A 0A 03 FC F4 01 77 00 00 0B 33", 0xBD),
    ("EF 20 95 0A 0A 04 FC F4 02 EE 00 00 0B 33", 0x8E),
    ("EF 20 95 0A 0A 05 FC F4 05 DC 00 00 0B 33", 0x9C),
    ("EF 20 95 0A 0A 06 FC F4 0B B8 00 00 0B 33", 0x58),
    ("EF 20 95 0A 0A 07 FC F4 17 70 00 00 0B 33", 0xB0),
    ("EF 20 95 0A 0A 08 FC F4 2E E0 00 00 0B 33", 0x20),
    ("EF 20 95 0A 0A 09 FC F4 5D C0 00 00 0B 33", 0x40),
    ("EF 20 95 0A 0A 0A FC F4 BB 80 00 00 0B 33", 0x87),
]

def test_all_polynomials():
    """Test all common CRC-8 polynomials"""
    print("\n" + "="*80)
    print("🔍 CRC-8 POLYNOMIAL SEARCH")
    print("="*80)
    print(f"\nTesting {len(test_commands)} captured commands against {len(POLYNOMIALS)} polynomials...")
    print()

    # Try each polynomial
    for poly_name, poly in POLYNOMIALS.items():
        # Try different init and xor_out values
        for init in [0x00, 0xFF]:
            for xor_out in [0x00, 0xFF]:
                matches = 0
                for cmd_hex, expected_crc in test_commands:
                    data = bytes.fromhex(cmd_hex.replace(" ", ""))
                    calculated = crc8(data, poly, init, xor_out)
                    if calculated == expected_crc:
                        matches += 1

                if matches == len(test_commands):
                    print(f"✅ FOUND MATCH!")
                    print(f"   Algorithm: {poly_name}")
                    print(f"   Polynomial: 0x{poly:02X}")
                    print(f"   Init: 0x{init:02X}")
                    print(f"   XOR Out: 0x{xor_out:02X}")
                    print()
                    return poly, init, xor_out

    print("❌ No match found with common CRC-8 polynomials")
    print()
    return None, None, None

def brute_force_polynomial():
    """Brute force search for the polynomial"""
    print("="*80)
    print("🔬 BRUTE FORCE POLYNOMIAL SEARCH")
    print("="*80)
    print("\nTrying all possible polynomials (0x00-0xFF)...")
    print("This may take a moment...")
    print()

    found = []

    for poly in range(256):
        for init in [0x00, 0xFF]:
            for xor_out in [0x00, 0xFF]:
                matches = 0
                for cmd_hex, expected_crc in test_commands:
                    data = bytes.fromhex(cmd_hex.replace(" ", ""))
                    calculated = crc8(data, poly, init, xor_out)
                    if calculated == expected_crc:
                        matches += 1

                if matches == len(test_commands):
                    found.append({
                        'poly': poly,
                        'init': init,
                        'xor_out': xor_out
                    })

    if found:
        print(f"✅ Found {len(found)} matching configuration(s):")
        print()
        for config in found:
            print(f"   Polynomial: 0x{config['poly']:02X}")
            print(f"   Init: 0x{config['init']:02X}")
            print(f"   XOR Out: 0x{config['xor_out']:02X}")
            print()

            # Verify with first command
            cmd_hex, expected_crc = test_commands[0]
            data = bytes.fromhex(cmd_hex.replace(" ", ""))
            calc = crc8(data, config['poly'], config['init'], config['xor_out'])
            print(f"   Verification: 0x{calc:02X} (expected: 0x{expected_crc:02X})")
            print()

        return found[0]['poly'], found[0]['init'], found[0]['xor_out']
    else:
        print("❌ No match found even with brute force")
        print("   The CRC might use a non-standard algorithm or table")
        print()
        return None, None, None

def generate_crc_function(poly, init, xor_out):
    """Generate Python and JavaScript CRC functions"""
    print("="*80)
    print("📝 IMPLEMENTATION CODE")
    print("="*80)

    print("\n🐍 Python Implementation:")
    print(f"""
def calculate_earfun_crc(data):
    '''Calculate CRC for Earfun Tune Pro commands'''
    crc = {init:#04x}
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ {poly:#04x}) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc ^ {xor_out:#04x}
""")

    print("\n📜 JavaScript Implementation:")
    print(f"""
function calculateEarfunCRC(data) {{
    // Calculate CRC for Earfun Tune Pro commands
    let crc = {init:#04x};
    for (let i = 0; i < data.length; i++) {{
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {{
            if (crc & 0x80) {{
                crc = ((crc << 1) ^ {poly:#04x}) & 0xFF;
            }} else {{
                crc = (crc << 1) & 0xFF;
            }}
        }}
    }}
    return crc ^ {xor_out:#04x};
}}
""")

    print("\n💡 Usage:")
    print("""
# Python
cmd = bytes([0xEF, 0x20, 0x95, 0x0A, 0x0A, 0x01, 0xFC, 0xF4, 0x00, 0x5E, 0x01, 0x2C, 0x0B, 0x33])
crc = calculate_earfun_crc(cmd)
print(f"CRC: 0x{crc:02X}")

// JavaScript
const cmd = [0xEF, 0x20, 0x95, 0x0A, 0x0A, 0x01, 0xFC, 0xF4, 0x00, 0x5E, 0x01, 0x2C, 0x0B, 0x33];
const crc = calculateEarfunCRC(cmd);
console.log(`CRC: 0x${crc.toString(16).toUpperCase().padStart(2, '0')}`);
""")

    print("="*80)

def main():
    print("\n" + "="*80)
    print("🎧 EARFUN TUNE PRO - CRC REVERSE ENGINEERING")
    print("="*80)
    print(f"\nAnalyzing {len(test_commands)} captured commands to find CRC algorithm...")
    print()

    # First try common polynomials
    poly, init, xor_out = test_all_polynomials()

    # If not found, brute force
    if poly is None:
        poly, init, xor_out = brute_force_polynomial()

    # Generate implementation code
    if poly is not None:
        generate_crc_function(poly, init, xor_out)
    else:
        print("\n❌ Could not determine CRC algorithm")
        print("\n💡 Suggestions:")
        print("   1. Capture more commands to find patterns")
        print("   2. The CRC might be:")
        print("      - A table-based lookup CRC")
        print("      - A custom algorithm")
        print("      - Not a CRC at all (custom checksum)")
        print("   3. Try analyzing the decompiled Android app for CRC code")
        print()

if __name__ == "__main__":
    main()
