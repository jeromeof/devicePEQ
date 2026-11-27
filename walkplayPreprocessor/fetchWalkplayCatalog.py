#!/usr/bin/env python3
"""
Rebuild walkplay.json from the live WalkPlay API.

The bulk product-list endpoint that walkplay.json was originally pulled from is
gone. peq.szwalkplay.com now looks products up one at a time:

    POST https://walkplay-api.szwalkplay.com/api/v3-1/product/detail
         {"pid": "0x4333", "vid": "0x3302"}

Responses are a JSON string: base64 of the JSON body XOR'd with the repeating key
b"d2Fsa3BsYXlAMjAyNS4uLw==" (base64 of "walkplay@2025../"). The same encoding is
used by /api/v3-1/common/queryProductVidList, which returns the vendor-ID list.

Which PIDs get queried:
  * every PID already in walkplay.json and in ../devicePEQ/usbDeviceConfig.js
  * --pids 0x4333,0x4334   extra PIDs
  * --radius N             also probe ±N around every known PID (finds new
                           neighbours; costs roughly 2N requests per known PID)

Each vendor ID from queryProductVidList is tried for each PID. Hits are merged
into walkplay.json (keyed by VendorId+ProductId) in the original
{"data": {"count", "data": [...]}} shape, so updateDeviceConfig.py works unchanged.

Usage:
  python3 fetchWalkplayCatalog.py [--radius 0] [--pids 0x4333] [--delay 0.2] [--dry-run]
"""

import argparse, base64, itertools, json, re, sys, time, urllib.request

API = 'https://walkplay-api.szwalkplay.com/api'
KEY = b'd2Fsa3BsYXlAMjAyNS4uLw=='
JSON_PATH = 'walkplay.json'
CONFIG_PATH = '../devicePEQ/usbDeviceConfig.js'
HEADERS = {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0',
           'Origin': 'https://peq.szwalkplay.com', 'Referer': 'https://peq.szwalkplay.com/'}


def decode(body):
    obj = json.loads(body)
    if isinstance(obj, str):
        raw = base64.b64decode(obj)
        obj = json.loads(bytes(a ^ b for a, b in zip(raw, itertools.cycle(KEY))).decode())
    return obj


def call(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f'{API}{path}', data=data, headers=HEADERS,
                                 method='POST' if data else 'GET')
    with urllib.request.urlopen(req, timeout=20) as r:
        return decode(r.read().decode())


def known_pids():
    pids = set()
    try:
        for e in json.load(open(JSON_PATH))['data']['data']:
            if re.match(r'^0x[0-9A-Fa-f]+$', e.get('ProductId', '')):
                pids.add(int(e['ProductId'], 16))
    except FileNotFoundError:
        pass
    cfg = open(CONFIG_PATH).read()
    for block in re.findall(r'(?:additionalProductIds|productIds):\s*\[([^\]]+)\]', cfg):
        pids |= {int(m, 16) for m in re.findall(r'0x([0-9A-Fa-f]+)', block)}
    return pids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--radius', type=int, default=0)
    ap.add_argument('--pids', default='')
    ap.add_argument('--delay', type=float, default=0.2, help='seconds between requests')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    vids = call('/v3-1/common/queryProductVidList')['data']
    print(f'Vendor IDs ({len(vids)}): {", ".join(vids)}')

    base = known_pids() | {int(p, 16) for p in args.pids.split(',') if p.strip()}
    pids = set(base)
    for p in base:
        pids |= {q for q in range(p - args.radius, p + args.radius + 1) if 0 < q <= 0xFFFF}
    total = len(pids) * len(vids)
    print(f'Querying {len(pids)} PIDs x {len(vids)} VIDs = {total} requests '
          f'(~{total * args.delay / 60:.1f} min at {args.delay}s)')

    try:
        existing = json.load(open(JSON_PATH))
    except FileNotFoundError:
        existing = {'msg': 'success', 'code': 0, 'data': {'count': 0, 'data': []}}
    by_key = {(e['VendorId'].upper(), e['ProductId'].upper()): e for e in existing['data']['data']}

    added, updated, n = [], [], 0
    for pid in sorted(pids):
        for vid in vids:
            n += 1
            try:
                res = call('/v3-1/product/detail', {'pid': f'0x{pid:04X}', 'vid': vid})
            except Exception as ex:
                print(f'  ! 0x{pid:04X}/{vid}: {ex}', file=sys.stderr)
                time.sleep(args.delay)
                continue
            e = res.get('data') if res.get('code') == 0 else None
            if e and e.get('ProductId'):
                key = (e['VendorId'].upper(), e['ProductId'].upper())
                if key not in by_key:
                    added.append(e)
                    print(f'  + {e["VendorId"]}:{e["ProductId"]} SchemeNo{e.get("SchemeNo")} '
                          f'"{e.get("TitleEn") or e.get("Title")}"')
                elif by_key[key].get('SchemeNo') != e.get('SchemeNo'):
                    updated.append(e)
                    print(f'  ~ {e["VendorId"]}:{e["ProductId"]} SchemeNo '
                          f'{by_key[key].get("SchemeNo")} -> {e.get("SchemeNo")}')
                by_key[key] = e
            if n % 100 == 0:
                print(f'  … {n}/{total}')
            time.sleep(args.delay)

    print(f'{len(added)} new, {len(updated)} scheme changes, {len(by_key)} total')
    if args.dry_run:
        print('Dry run — walkplay.json not written.')
        return
    entries = sorted(by_key.values(), key=lambda e: (e['VendorId'], e['ProductId']))
    existing['data'] = {'count': len(entries), 'data': entries}
    json.dump(existing, open(JSON_PATH, 'w'), ensure_ascii=False, indent=2)
    print(f'Wrote {JSON_PATH}. Next: python3 updateDeviceConfig.py --dry-run')


if __name__ == '__main__':
    main()
