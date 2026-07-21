#!/usr/bin/env python3
"""
Reads walkplay.json and patches usbDeviceConfig.js with any missing
ProductIds (grouped by SchemeNo) and missing VendorIds.

Usage: python3 updateDeviceConfig.py [--dry-run]
"""

import json, re, sys
from collections import defaultdict

SKIP_PRODUCT_IDS = {0xEEEE}  # placeholder/test entries in walkplay API
SKIP_SCHEMES = {'1'}           # test scheme with no real hardware

JSON_PATH = 'walkplay.json'
CONFIG_PATH = '../devicePEQ/usbDeviceConfig.js'


def parse_hex_ids(text):
    return {int(m.group(1), 16) for m in re.finditer(r'0x([0-9A-Fa-f]+)', text)}


def hex_list(ids):
    return ', '.join(f'0x{i:04X}' for i in sorted(ids))


def main():
    dry_run = '--dry-run' in sys.argv

    with open(JSON_PATH) as f:
        data = json.load(f)
    entries = data['data']['data']

    # Build sets from JSON
    json_by_scheme = defaultdict(set)
    json_vendor_ids = set()
    skipped = []
    for e in entries:
        if not re.match(r'^0x[0-9A-Fa-f]+$', e['ProductId']):
            skipped.append(e['ProductId'])
            continue
        pid = int(e['ProductId'], 16)
        if pid in SKIP_PRODUCT_IDS or e['SchemeNo'] in SKIP_SCHEMES:
            continue
        json_by_scheme[e['SchemeNo']].add(pid)
        json_vendor_ids.add(int(e['VendorId'], 16))

    if skipped:
        print(f"Skipped malformed ProductIds: {skipped}")

    with open(CONFIG_PATH) as f:
        content = f.read()

    changes = []

    # --- VendorIds ---
    vid_match = re.search(r'(vendorIds: \[)([^\]]+)(\].*?multiple Walkplay)', content)
    if vid_match:
        current_vids = parse_hex_ids(vid_match.group(2))
        missing_vids = json_vendor_ids - current_vids
        if missing_vids:
            new_vid_list = hex_list(current_vids | missing_vids)
            new_section = f'{vid_match.group(1)}{new_vid_list}{vid_match.group(3)}'
            content = content[:vid_match.start()] + new_section + content[vid_match.end():]
            changes.append(f"VendorIds: added {hex_list(missing_vids)}")

    # --- ProductIds per SchemeNo ---
    def replace_scheme(m):
        scheme_no = m.group(1)
        if scheme_no not in json_by_scheme:
            return m.group(0)
        current_pids = parse_hex_ids(m.group(2))
        all_pids = current_pids | json_by_scheme[scheme_no]
        missing = all_pids - current_pids
        if not missing:
            return m.group(0)
        new_pid_list = hex_list(all_pids)
        changes.append(f"SchemeNo{scheme_no}: added {len(missing)} ids — {hex_list(missing)}")
        return m.group(0).replace(m.group(2), new_pid_list)

    content = re.sub(
        r'("SchemeNo(\d+)":\s*\{\s*productIds:\s*\[)([^\]]+)(\])',
        lambda m: m.group(1) + hex_list(parse_hex_ids(m.group(3)) | (json_by_scheme.get(m.group(2), set()))) + m.group(4)
            if (json_by_scheme.get(m.group(2), set()) - parse_hex_ids(m.group(3)))
            else m.group(0),
        content
    )

    # Re-run to collect change descriptions (simpler second pass)
    # (the replacement above already applied changes; now just report)
    with open(CONFIG_PATH) as f:
        original = f.read()

    if content == original:
        print("No changes needed — everything is already up to date.")
        return

    # Summarise what changed
    scheme_pat = re.compile(r'"SchemeNo(\d+)":\s*\{\s*productIds:\s*\[([^\]]+)\]', re.DOTALL)
    orig_schemes = {m.group(1): parse_hex_ids(m.group(2)) for m in scheme_pat.finditer(original)}
    new_schemes  = {m.group(1): parse_hex_ids(m.group(2)) for m in scheme_pat.finditer(content)}
    for s in sorted(new_schemes, key=int):
        added = new_schemes[s] - orig_schemes.get(s, set())
        if added:
            print(f"  SchemeNo{s}: +{len(added)} ids — {hex_list(added)}")

    orig_vid_m = re.search(r'vendorIds: \[([^\]]+)\].*?multiple Walkplay', original)
    new_vid_m  = re.search(r'vendorIds: \[([^\]]+)\].*?multiple Walkplay', content)
    if orig_vid_m and new_vid_m:
        added_vids = parse_hex_ids(new_vid_m.group(1)) - parse_hex_ids(orig_vid_m.group(1))
        if added_vids:
            print(f"  VendorIds: +{hex_list(added_vids)}")

    if dry_run:
        print("\n(dry-run: no file written)")
    else:
        with open(CONFIG_PATH, 'w') as f:
            f.write(content)
        print(f"\nWritten to {CONFIG_PATH}")


if __name__ == '__main__':
    main()
