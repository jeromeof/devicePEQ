#!/usr/bin/env python3
"""
Sony Headphones Bluetooth Protocol Implementation
Supports WH-1000XM5, WH-1000XM6, WF-1000XM5, and LinkBuds series

Based on decompiled Sony SoundConnect APK analysis
Protocol internally called "Tandem"
"""

from dataclasses import dataclass
from typing import List, Optional
from enum import IntEnum

# BLE Service and Characteristic UUIDs
SERVICE_UUID = "45C93E07-D90D-4B93-A9DB-91E5DD734E35"
WRITE_CHAR_UUID = "45C93C15-D90D-4B93-A9DB-91E5DD734E35"
NOTIFY_CHAR_UUID = "45C93C16-D90D-4B93-A9DB-91E5DD734E35"

class CommandCode(IntEnum):
    """Sony Protocol Command Codes"""
    # EQ Commands
    EQEBB_GET_CAPABILITY = 0x50  # Get EQ capability information
    EQEBB_RET_CAPABILITY = 0x51  # Return EQ capability
    EQEBB_GET_STATUS = 0x52      # Get current EQ status
    EQEBB_RET_STATUS = 0x53      # Return EQ status
    EQEBB_NTFY_STATUS = 0x55     # EQ status notification
    EQEBB_GET_PARAM = 0x56       # Get EQ parameters
    EQEBB_RET_PARAM = 0x57       # Return EQ parameters
    EQEBB_SET_PARAM = 0x58       # Set EQ parameters
    EQEBB_NTFY_PARAM = 0x59      # EQ parameter notification
    EQEBB_GET_EXTENDED_INFO = 0x5A  # Get extended EQ info
    EQEBB_RET_EXTENDED_INFO = 0x5B  # Return extended EQ info

    # Common Commands
    COMMON_GET_BATTERY_LEVEL = 0x10  # Get battery level
    COMMON_RET_BATTERY_LEVEL = 0x11  # Return battery level
    COMMON_GET_AUDIO_CODEC = 0x18    # Get audio codec
    COMMON_RET_AUDIO_CODEC = 0x19    # Return audio codec

    # Noise Canceling / Ambient Sound Mode (NCASM)
    NCASM_GET_CAPABILITY = 0x60  # Get NC/ASM capability
    NCASM_GET_STATUS = 0x62      # Get NC/ASM status
    NCASM_SET_PARAM = 0x68       # Set NC/ASM parameters

class EQPresetId(IntEnum):
    """EQ Preset IDs"""
    OFF = 0x00
    ROCK = 0x01
    POP = 0x02
    JAZZ = 0x03
    DANCE = 0x04
    EDM = 0x05
    R_AND_B_HIP_HOP = 0x06
    ACOUSTIC = 0x07
    BRIGHT = 0x10
    EXCITED = 0x11
    MELLOW = 0x12
    RELAXED = 0x13
    VOCAL = 0x14
    TREBLE = 0x15
    BASS = 0x16
    SPEECH = 0x17
    CUSTOM = 0xA0
    USER_SETTING1 = 0xA1
    USER_SETTING2 = 0xA2
    USER_SETTING3 = 0xA3
    USER_SETTING4 = 0xA4
    USER_SETTING5 = 0xA5

    @classmethod
    def get_name(cls, preset_id: int) -> str:
        """Get human-readable preset name"""
        names = {
            cls.OFF: "Off",
            cls.ROCK: "Rock",
            cls.POP: "Pop",
            cls.JAZZ: "Jazz",
            cls.DANCE: "Dance",
            cls.EDM: "EDM",
            cls.R_AND_B_HIP_HOP: "R&B/Hip-Hop",
            cls.ACOUSTIC: "Acoustic",
            cls.BRIGHT: "Bright",
            cls.EXCITED: "Excited",
            cls.MELLOW: "Mellow",
            cls.RELAXED: "Relaxed",
            cls.VOCAL: "Vocal",
            cls.TREBLE: "Treble",
            cls.BASS: "Bass",
            cls.SPEECH: "Speech",
            cls.CUSTOM: "Custom",
            cls.USER_SETTING1: "User Setting 1",
            cls.USER_SETTING2: "User Setting 2",
            cls.USER_SETTING3: "User Setting 3",
            cls.USER_SETTING4: "User Setting 4",
            cls.USER_SETTING5: "User Setting 5",
        }
        return names.get(preset_id, f"Unknown (0x{preset_id:02X})")

class EQInquiredType(IntEnum):
    """EQ Inquired Type"""
    PRESET_EQ = 0x01

@dataclass
class SonyEQStatus:
    """Represents current EQ status"""
    preset_id: int
    band_values: List[int]  # List of band gain values in dB (-10 to +10)

    def __str__(self):
        preset_name = EQPresetId.get_name(self.preset_id)
        bands_str = ", ".join(f"{v:+d}dB" for v in self.band_values)
        return f"{preset_name}: [{bands_str}]"

@dataclass
class SonyEQCapability:
    """Represents EQ capability information"""
    min_gain: int  # Minimum gain in dB
    max_gain: int  # Maximum gain in dB
    presets: List[tuple]  # List of (preset_id, preset_name)

    def __str__(self):
        presets_str = "\n    ".join(f"0x{pid:02X}: {name}" for pid, name in self.presets)
        return f"Gain Range: {self.min_gain} to {self.max_gain} dB\n  Presets:\n    {presets_str}"

class SonyProtocol:
    """Sony Headphones Protocol Implementation"""

    # Typical 5-band EQ frequencies (not configurable, fixed in hardware)
    TYPICAL_FREQUENCIES = [400, 1000, 2500, 6300, 16000]  # Hz

    def __init__(self):
        pass

    def get_eq_capability(self, language_code: int = 0x00) -> bytes:
        """
        Get EQ capability information

        Args:
            language_code: Display language (0x00 = English)

        Returns:
            Command bytes to send
        """
        return bytes([
            CommandCode.EQEBB_GET_CAPABILITY,
            EQInquiredType.PRESET_EQ,
            language_code
        ])

    def get_eq_status(self) -> bytes:
        """
        Get current EQ status

        Returns:
            Command bytes to send
        """
        return bytes([
            CommandCode.EQEBB_GET_STATUS,
            EQInquiredType.PRESET_EQ
        ])

    def set_eq_preset(self, preset_id: int) -> bytes:
        """
        Set EQ to a specific preset

        Args:
            preset_id: Preset ID (use EQPresetId enum)

        Returns:
            Command bytes to send
        """
        return bytes([
            CommandCode.EQEBB_SET_PARAM,
            EQInquiredType.PRESET_EQ,
            preset_id,
            0x00  # 0 bands (use preset values)
        ])

    def set_custom_eq(self, band_values: List[int]) -> bytes:
        """
        Set custom EQ values

        Args:
            band_values: List of band gain values in dB (typically 5 bands)
                        Range: -10 to +10 dB
                        Example: [8, 5, 0, -2, 0] for bass boost

        Returns:
            Command bytes to send

        Raises:
            ValueError: If band values are out of range
        """
        if not band_values or len(band_values) > 20:
            raise ValueError("Invalid number of bands (must be 1-20)")

        # Clamp and convert to signed bytes
        band_bytes = []
        for v in band_values:
            clamped = max(-10, min(10, v))
            # Convert to signed byte
            if clamped < 0:
                band_bytes.append(256 + clamped)
            else:
                band_bytes.append(clamped)

        return bytes([
            CommandCode.EQEBB_SET_PARAM,
            EQInquiredType.PRESET_EQ,
            EQPresetId.CUSTOM,
            len(band_bytes)
        ] + band_bytes)

    def get_battery_level(self) -> bytes:
        """
        Get battery level

        Returns:
            Command bytes to send
        """
        return bytes([CommandCode.COMMON_GET_BATTERY_LEVEL])

    @staticmethod
    def parse_eq_status(data: bytes) -> Optional[SonyEQStatus]:
        """
        Parse EQEBB_RET_STATUS response

        Args:
            data: Response bytes

        Returns:
            SonyEQStatus object or None if invalid
        """
        if len(data) < 5:
            return None

        if data[0] != CommandCode.EQEBB_RET_STATUS:
            return None

        preset_id = data[2]
        num_bands = data[3]

        band_values = []
        for i in range(num_bands):
            if 4 + i < len(data):
                # Convert unsigned byte to signed
                value = data[4 + i]
                if value > 127:
                    value = value - 256
                band_values.append(value)

        return SonyEQStatus(preset_id=preset_id, band_values=band_values)

    @staticmethod
    def parse_eq_capability(data: bytes) -> Optional[SonyEQCapability]:
        """
        Parse EQEBB_RET_CAPABILITY response

        Args:
            data: Response bytes

        Returns:
            SonyEQCapability object or None if invalid
        """
        if len(data) < 5:
            return None

        if data[0] != CommandCode.EQEBB_RET_CAPABILITY:
            return None

        # Parse min/max gain (signed bytes)
        min_gain = data[2]
        if min_gain > 127:
            min_gain = min_gain - 256

        max_gain = data[3]
        if max_gain > 127:
            max_gain = max_gain - 256

        num_presets = data[4]

        # Parse preset list
        presets = []
        offset = 5
        for i in range(num_presets):
            if offset >= len(data):
                break

            preset_id = data[offset]
            if offset + 1 >= len(data):
                break

            name_length = data[offset + 1]

            if offset + 2 + name_length <= len(data):
                try:
                    preset_name = data[offset + 2:offset + 2 + name_length].decode('utf-8', errors='ignore')
                    presets.append((preset_id, preset_name))
                except:
                    pass

            offset += 2 + name_length

        return SonyEQCapability(min_gain=min_gain, max_gain=max_gain, presets=presets)

    @staticmethod
    def parse_battery_level(data: bytes) -> Optional[int]:
        """
        Parse COMMON_RET_BATTERY_LEVEL response

        Args:
            data: Response bytes

        Returns:
            Battery percentage (0-100) or None if invalid
        """
        if len(data) < 2:
            return None

        if data[0] != CommandCode.COMMON_RET_BATTERY_LEVEL:
            return None

        return data[1]

def format_eq_bands(band_values: List[int], frequencies: Optional[List[int]] = None) -> str:
    """
    Format EQ bands for display

    Args:
        band_values: List of gain values in dB
        frequencies: Optional list of frequency values (default: typical 5-band)

    Returns:
        Formatted string
    """
    if frequencies is None:
        frequencies = SonyProtocol.TYPICAL_FREQUENCIES

    lines = []
    for i, (freq, gain) in enumerate(zip(frequencies, band_values)):
        if freq >= 1000:
            freq_str = f"{freq/1000:.1f}kHz"
        else:
            freq_str = f"{freq}Hz"
        lines.append(f"  Band {i+1}: {freq_str:>8} = {gain:+3d} dB")

    return "\n".join(lines)


# CLI Testing Functions
if __name__ == "__main__":
    import sys

    protocol = SonyProtocol()

    print("=" * 80)
    print("Sony Headphones Protocol - Test Command Generator")
    print("=" * 80)
    print()

    print("📋 Test Commands:\n")

    print("1️⃣  Get EQ Capability:")
    cmd = protocol.get_eq_capability()
    print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
    print(f"   Expect RX: 51 01 [min] [max] [num_presets] ...")
    print()

    print("2️⃣  Get EQ Status:")
    cmd = protocol.get_eq_status()
    print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
    print(f"   Expect RX: 53 01 [preset_id] [num_bands] [band1] [band2] ...")
    print()

    print("3️⃣  Set Bass Preset:")
    cmd = protocol.set_eq_preset(EQPresetId.BASS)
    print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
    print()

    print("4️⃣  Set Custom EQ (Bass Boost: +8, +5, 0, -2, 0):")
    cmd = protocol.set_custom_eq([8, 5, 0, -2, 0])
    print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
    print()

    print("5️⃣  Get Battery Level:")
    cmd = protocol.get_battery_level()
    print(f"   TX: {' '.join(f'{b:02X}' for b in cmd)}")
    print(f"   Expect RX: 11 [battery%]")
    print()

    print("=" * 80)
    print("📚 Available Presets:")
    print("=" * 80)
    for preset in EQPresetId:
        if preset.value <= 0x17 or preset.value >= 0xA0:
            print(f"  0x{preset.value:02X}: {EQPresetId.get_name(preset.value)}")
    print()

    print("=" * 80)
    print("💡 Usage with Web Bluetooth or Python bleak:")
    print("=" * 80)
    print(f"Service UUID:  {SERVICE_UUID}")
    print(f"Write Char:    {WRITE_CHAR_UUID}")
    print(f"Notify Char:   {NOTIFY_CHAR_UUID}")
    print()
    print("Write commands to WRITE_CHAR, listen for responses on NOTIFY_CHAR")
