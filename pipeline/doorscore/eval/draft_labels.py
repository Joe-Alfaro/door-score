"""Model-assisted labeling: a stronger model drafts labels; a human verifies every row in the labeler UI.

The draft model is deliberately different from (and stronger than) the production detector so the
eval is not the detector grading itself. Drafts are marked verified_by_human=false until confirmed.
Usage: python -m doorscore.eval.draft_labels [--model claude-opus-5-5]
"""
import argparse, json
from pathlib import Path
import anthropic
from ..config import DATA
from ..vision.detect import analyze_image
from .schema import BINARY_SIGNALS, CONDITION_SIGNALS

EVAL = DATA / 'eval'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='claude-opus-5-5')
    args = ap.parse_args()
    rows = [json.loads(l) for l in (EVAL / 'sample.jsonl').read_text().splitlines() if l.strip()]
    client = anthropic.Anthropic()
    for r in rows:
        if r.get('labeler'):
            continue
        res = analyze_image(str(EVAL / r['image']), r['door_id'], model=args.model, client=client)
        s = res['signals']
        r['image_usable'] = s['image_usable']
        for k in BINARY_SIGNALS:
            r[k] = bool(s[k]['present'] and s[k]['confidence'] >= 0.5)
        for k in CONDITION_SIGNALS:
            r[k] = s[k]
        r['labeler'] = f'draft:{args.model}'
        r['verified_by_human'] = False
    (EVAL / 'sample.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
    print(f'drafted labels for {len(rows)} rows with {args.model}; verify them in the labeler')

if __name__ == '__main__':
    main()
