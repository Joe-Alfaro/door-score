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
    args = ap.parse_args()
    random.seed(args.seed)
    doors = json.loads((DATA / 'out' / 'doors.json').read_text())
    with_img = [d for d in doors if d.get('vision') and d['vision'].get('image')]
    if not with_img:
        raise SystemExit('No doors with imagery yet. Run the pipeline with --vision first.')
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

if __name__ == '__main__':
    main()
