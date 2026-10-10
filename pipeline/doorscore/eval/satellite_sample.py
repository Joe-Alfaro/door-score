"""Build the overhead-imagery eval sample: every rare positive plus pools and random tiles.

Usage: python -m doorscore.eval.satellite_sample --n 100
Writes data/eval/satellite/sample.jsonl (pre-filled with the production model's cached prediction,
to be confirmed or corrected by a human), copies tiles to data/eval/satellite/images/ (gitignored:
Google imagery), and drops a labeler page next to them.
"""
import argparse, json, random, shutil
from pathlib import Path
from ..config import DATA, CACHE

EVAL = DATA / 'eval' / 'satellite'
BINARY = ['swimming_pool', 'solar_panels', 'play_equipment', 'detached_structure']
CONDITIONS = ['roof_condition', 'tree_cover']
CONF = 0.5

def label_row(d: dict) -> dict:
    s = d['satellite']['signals']
    row = {'door_id': d['door_id'], 'image': f'images/{d["door_id"]}.png', 'image_usable': s['image_usable']}
    for k in BINARY:
        row[k] = bool(s[k]['present'] and s[k]['confidence'] >= CONF)
    for k in CONDITIONS:
        row[k] = s[k]
    row.update({'labeler': f'prefill:{d["satellite"]["model"]}', 'verified_by_human': False, 'note': ''})
    return row

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=100)
    ap.add_argument('--seed', type=int, default=11)
    args = ap.parse_args()
    random.seed(args.seed)
    doors = [d for d in json.loads((DATA / 'out' / 'doors.json').read_text()) if d.get('satellite')]
    def pos(d, k): s = d['satellite']['signals'][k]; return s['present'] and s['confidence'] >= CONF
    solar = [d for d in doors if pos(d, 'solar_panels')]
    play = [d for d in doors if pos(d, 'play_equipment')]
    pools = [d for d in doors if pos(d, 'swimming_pool') and d not in solar and d not in play]
    chosen = solar + play + random.sample(pools, min(30, len(pools)))
    rest = [d for d in doors if d not in chosen]
    chosen += random.sample(rest, max(0, args.n - len(chosen)))
    random.shuffle(chosen)
    (EVAL / 'images').mkdir(parents=True, exist_ok=True)
    rows = []
    for d in chosen:
        src = next((p for p in (CACHE / 'satellite').glob(f'{d["door_id"]}.*')), None)
        if not src: continue
        dst = EVAL / 'images' / f'{d["door_id"]}.png'
        if not dst.exists(): shutil.copy(src, dst)
        rows.append(label_row(d))
    (EVAL / 'sample.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
    html = (Path(__file__).with_name('labeler.html').read_text()
            .replace("const BIN=['provider_truck','moving_indicators','yard_sign','renovation_activity','professional_landscaping','solar_panels']", f"const BIN={json.dumps(BINARY)}")
            .replace("const COND=['lawn_condition','exterior_condition','roof_condition']", f"const COND={json.dumps(CONDITIONS)}")
            .replace("const LEVELS=['poor','fair','good','excellent','not_visible']", "const LEVELS=['poor','fair','good','excellent','not_visible','low','medium','high']")
            .replace("const KEY='doorscore-labels'", "const KEY='doorscore-satellite-labels'")
            .replace("'123456'.includes(e.key)", "'1234'.includes(e.key)").replace('Keys: 1-6 toggle', 'Keys: 1-4 toggle')
            .replace('Image usable (shows a house frontage)', 'Tile usable (lot clearly visible from above)')
            .replace('<title>Door Score — eval labeler</title>', '<title>Door Score — overhead eval labeler</title>'))
    (EVAL / 'labeler.html').write_text(html)
    print(f'{len(rows)} tiles: solar {len(solar)}, play {len(play)}, pools {min(30, len(pools))}, random {len(rows) - len(solar) - len(play) - min(30, len(pools))} -> {EVAL}')

if __name__ == '__main__':
    main()
