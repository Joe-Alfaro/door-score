"""Eval harness: precision/recall per signal, hallucination rate, cost per door.

Usage: python -m doorscore.eval.run_eval [--model claude-haiku-4-5] [--labels data/eval/labels.jsonl]
Only rows with verified_by_human=true count. Writes data/eval/results_<model>.json and prints a table.
"""
import argparse, json
from pathlib import Path
from ..config import DATA
from ..vision.detect import analyze_image, DEFAULT_MODEL
from ..costs import summary as cost_summary
from .schema import BINARY_SIGNALS, CONDITION_SIGNALS, CONDITIONS, TOP_SIGNAL

EVAL = DATA / 'eval'

def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f = 2 * p * r / (p + r) if p and r else None
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': p, 'recall': r, 'f1': f}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--labels', default=str(EVAL / 'labels.jsonl'))
    ap.add_argument('--conf', type=float, default=0.6, help='confidence threshold applied to predictions')
    ap.add_argument('--include-unverified', action='store_true')
    args = ap.parse_args()
    rows = [json.loads(l) for l in Path(args.labels).read_text().splitlines() if l.strip()]
    rows = [r for r in rows if r.get('verified_by_human') or args.include_unverified]
    if not rows:
        raise SystemExit('No verified labels. Verify rows in the labeler first (or pass --include-unverified).')
    preds = {r['door_id']: analyze_image(str(EVAL / r['image']), r['door_id'], model=args.model)['signals'] for r in rows}

    results = {'model': args.model, 'conf_threshold': args.conf, 'n_labeled': len(rows), 'signals': {}}
    for k in BINARY_SIGNALS:
        tp = fp = fn = tn = 0
        for r in rows:
            if r[k] is None: continue
            p = preds[r['door_id']][k]
            pred = p['present'] and p['confidence'] >= args.conf
            tp += pred and r[k]; fp += pred and not r[k]; fn += (not pred) and r[k]; tn += (not pred) and not r[k]
        m = prf(tp, fp, fn)
        m['tn'] = tn
        # Hallucination rate: of images a human says do NOT contain X, how often did the model assert X?
        m['hallucination_rate'] = fp / (fp + tn) if fp + tn else None
        m['support_pos'] = tp + fn
        results['signals'][k] = m
    for k in CONDITION_SIGNALS:
        exact = within1 = n = 0
        for r in rows:
            if r[k] in (None, 'not_visible'): continue
            p = preds[r['door_id']][k]
            if p == 'not_visible': continue
            n += 1; exact += p == r[k]
            within1 += abs(CONDITIONS.index(p) - CONDITIONS.index(r[k])) <= 1
        results['signals'][k] = {'n': n, 'exact_agreement': exact / n if n else None, 'within_one_step': within1 / n if n else None}
    # Usability hallucination: model says usable but human says not.
    u_fp = sum(1 for r in rows if r['image_usable'] is False and preds[r['door_id']]['image_usable'])
    u_n = sum(1 for r in rows if r['image_usable'] is False)
    results['usability_false_positive_rate'] = u_fp / u_n if u_n else None
    results['top_signal'] = TOP_SIGNAL
    results['cost'] = cost_summary()
    out = EVAL / f'results_{args.model}.json'
    out.write_text(json.dumps(results, indent=1))

    def fmt(x): return '—' if x is None else f'{x:.2f}'
    print(f'\nEval: {args.model}  n={len(rows)} verified images  conf>={args.conf}')
    print(f'{"signal":28}{"P":>6}{"R":>6}{"F1":>6}{"halluc":>8}{"pos":>5}')
    for k in BINARY_SIGNALS:
        m = results['signals'][k]
        print(f'{k:28}{fmt(m["precision"]):>6}{fmt(m["recall"]):>6}{fmt(m["f1"]):>6}{fmt(m["hallucination_rate"]):>8}{m["support_pos"]:>5}')
    for k in CONDITION_SIGNALS:
        m = results['signals'][k]
        print(f'{k:28} exact={fmt(m["exact_agreement"])} within1={fmt(m["within_one_step"])} n={m["n"]}')
    c = results['cost']
    pr = c['production']
    print(f'cost: production ({pr["model"]}) ${pr["usd"]} over {pr["doors"]} doors = ${pr["usd_per_door"]}/door; '
          f'eval+discovery ${c["eval_and_discovery_usd"]}; total ${c["total_usd"]}')
    print(f'wrote {out}')

if __name__ == '__main__':
    main()
