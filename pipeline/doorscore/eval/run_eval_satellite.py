"""Eval for the overhead-imagery detector on human-verified tiles.

Usage: python -m doorscore.eval.run_eval_satellite [--model claude-sonnet-5-5]
Predictions come from the satellite vision cache (door_id + zoom key), so no API calls.
"""
import argparse, json
from pathlib import Path
from ..config import DATA
from ..vision.satellite_detect import analyze_image as analyze_tile, DEFAULT_MODEL
from .run_eval import prf
from .satellite_sample import BINARY, CONDITIONS

EVAL = DATA / 'eval' / 'satellite'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--conf', type=float, default=0.5)
    ap.add_argument('--include-unverified', action='store_true')
    args = ap.parse_args()
    rows = [json.loads(l) for l in (EVAL / 'labels.jsonl').read_text().splitlines() if l.strip()]
    rows = [r for r in rows if r.get('verified_by_human') or args.include_unverified]
    if not rows: raise SystemExit('no verified satellite labels')
    preds = {}
    for r in rows:
        img = EVAL / r['image']
        try:
            preds[r['door_id']] = analyze_tile(str(img), r['door_id'], model=args.model, zoom=20)['signals']
        except TypeError:
            preds[r['door_id']] = analyze_tile(str(img), r['door_id'], model=args.model)['signals']
    res = {'model': args.model, 'conf_threshold': args.conf, 'n_labeled': len(rows), 'signals': {}}
    for k in BINARY:
        tp = fp = fn = tn = 0
        for r in rows:
            if r[k] is None: continue
            p = preds[r['door_id']][k]; pred = p['present'] and p['confidence'] >= args.conf
            tp += pred and r[k]; fp += pred and not r[k]; fn += (not pred) and r[k]; tn += (not pred) and not r[k]
        m = prf(tp, fp, fn); m['tn'] = tn; m['hallucination_rate'] = fp / (fp + tn) if fp + tn else None; m['support_pos'] = tp + fn
        res['signals'][k] = m
    for k in CONDITIONS:
        n = exact = 0
        for r in rows:
            if r[k] in (None, 'not_visible'): continue
            p = preds[r['door_id']][k]
            if p == 'not_visible': continue
            n += 1; exact += p == r[k]
        res['signals'][k] = {'n': n, 'exact_agreement': exact / n if n else None}
    out = EVAL / f'results_{args.model}.json'; out.write_text(json.dumps(res, indent=1))
    f = lambda x: '—' if x is None else f'{x:.2f}'
    print(f'\nOverhead eval: {args.model}  n={len(rows)} verified tiles  conf>={args.conf}')
    print(f'{"signal":22}{"P":>6}{"R":>6}{"F1":>6}{"halluc":>8}{"pos":>5}')
    for k in BINARY:
        m = res['signals'][k]; print(f'{k:22}{f(m["precision"]):>6}{f(m["recall"]):>6}{f(m["f1"]):>6}{f(m["hallucination_rate"]):>8}{m["support_pos"]:>5}')
    for k in CONDITIONS:
        m = res['signals'][k]; print(f'{k:22} exact={f(m["exact_agreement"])} n={m["n"]}')
    print('wrote', out)

if __name__ == '__main__':
    main()
