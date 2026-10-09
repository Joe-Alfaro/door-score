"""Pick the eval sample: stratified so rare positives (trucks, signs) are represented.

Usage: python -m doorscore.eval.sample --n 80
Writes data/eval/sample.jsonl with empty labels and copies images into data/eval/images/.
"""
import argparse, json, random, shutil
from pathlib import Path
from ..config import DATA, CACHE
from .schema import empty_label, BINARY_SIGNALS

EVAL = DATA / 'eval'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=80)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--add-positives', action='store_true',
                    help='append every door the production model flagged for a rare signal (truck, moving, renovation, yard sign) to the existing sample')
    ap.add_argument('--conf', type=float, default=0.6)
    args = ap.parse_args()
    random.seed(args.seed)
    doors = json.loads((DATA / 'out' / 'doors.json').read_text())
    with_img = [d for d in doors if d.get('vision') and d['vision'].get('image')]
    if not with_img:
        raise SystemExit('No doors with imagery yet. Run the pipeline with --vision first.')
    if args.add_positives:
        return add_positives(with_img, args.conf)
    # Oversample model-positive doors so precision can actually be measured; the rest is random.
    positives = [d for d in with_img if any(d['vision']['signals'][k]['present'] for k in BINARY_SIGNALS)]
    negatives = [d for d in with_img if d not in positives]
    k_pos = min(len(positives), args.n // 2)
    sample = random.sample(positives, k_pos) + random.sample(negatives, min(len(negatives), args.n - k_pos))
    random.shuffle(sample)
    (EVAL / 'images').mkdir(parents=True, exist_ok=True)
    rows = []
    for d in sample:
        src = Path(d['vision']['image']['path'])
        dst = EVAL / 'images' / src.name
        if not dst.exists():
            shutil.copy(src, dst)
        rows.append(empty_label(d['door_id'], f'images/{src.name}'))
    (EVAL / 'sample.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
    shutil.copy(Path(__file__).with_name('labeler.html'), EVAL / 'labeler.html')
    print(f'wrote {len(rows)} rows to {EVAL/"sample.jsonl"} ({k_pos} model-positive, {len(rows)-k_pos} model-negative)')

RARE = ['provider_truck', 'moving_indicators', 'renovation_activity', 'yard_sign']

def add_positives(with_img, conf):
    """Rare signals need every candidate positive in the sample, or precision has no support."""
    path = EVAL / 'sample.jsonl'
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []
    have = {r['door_id'] for r in rows}
    added = 0
    for d in with_img:
        s = d['vision']['signals']
        if d['door_id'] in have or not any(s[k]['present'] and s[k]['confidence'] >= conf for k in RARE):
            continue
        src = Path(d['vision']['image']['path']); dst = EVAL / 'images' / src.name
        if not dst.exists():
            shutil.copy(src, dst)
        rows.append(empty_label(d['door_id'], f'images/{src.name}')); added += 1
    path.write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
    print(f'appended {added} production-positive doors; sample is now {len(rows)} rows')

if __name__ == '__main__':
    main()
