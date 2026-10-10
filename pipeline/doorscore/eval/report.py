"""Render eval results into docs/test-results.md between the VISION-EVAL markers.

Usage: python -m doorscore.eval.report   (after run_eval for one or more models)
"""
import json, re
from pathlib import Path
from ..config import DATA, ROOT
from .schema import BINARY_SIGNALS, CONDITION_SIGNALS

DOC = ROOT / 'docs' / 'test-results.md'
START, END = '<!-- VISION-EVAL:START -->', '<!-- VISION-EVAL:END -->'

def fmt(x, pct=False):
    if x is None: return '—'
    return f'{x:.0%}' if pct else f'{x:.2f}'

def render(results: list[dict]) -> str:
    out = []
    n = results[0]['n_labeled']
    out.append(f'{n} human-verified Street View images (stratified: model-positive, random, and every production-model positive for rare signals). '
               f'Predictions gated at confidence ≥ {results[0]["conf_threshold"]}. Hallucination rate = share of images a human marked negative that the model asserted positive.\n')
    models = [r['model'] for r in results]
    out.append('| Signal | Pos. labels | ' + ' | '.join(f'{m} P / R / F1 / halluc.' for m in models) + ' |')
    out.append('|---|---|' + '|'.join('---' for _ in models) + '|')
    for k in BINARY_SIGNALS:
        cells = []
        for r in results:
            m = r['signals'][k]
            cells.append(f'{fmt(m["precision"])} / {fmt(m["recall"])} / {fmt(m["f1"])} / {fmt(m["hallucination_rate"], True)}')
        sup = results[0]['signals'][k]['support_pos']
        label = f'**{k}** (top signal)' if k == results[0].get('top_signal') else k
        out.append(f'| {label} | {sup} | ' + ' | '.join(cells) + ' |')
    out.append('')
    out.append('| Condition rating | ' + ' | '.join(f'{m} exact / within one step' for m in models) + ' |')
    out.append('|---|' + '|'.join('---' for _ in models) + '|')
    for k in CONDITION_SIGNALS:
        cells = [f'{fmt(r["signals"][k]["exact_agreement"], True)} / {fmt(r["signals"][k]["within_one_step"], True)} (n={r["signals"][k]["n"]})' for r in results]
        out.append(f'| {k} | ' + ' | '.join(cells) + ' |')
    out.append('')
    out.append('Image-usability false-positive rate (model called a frame usable, human did not): ' + ', '.join(f'{r["model"]} {fmt(r.get("usability_false_positive_rate"), True)}' for r in results) + '\n')
    out.append('Confidence-gate sweep for the production model (precision / recall):\n')
    prod = results[-1] if len(results) == 1 else next((r for r in results if r['model'] == r['cost']['production']['model']), results[0])
    sw = prod.get('threshold_sweep', {})
    if sw:
        sigs = [k for k in BINARY_SIGNALS if prod['signals'][k]['support_pos']]
        out.append('| gate | ' + ' | '.join(sigs) + ' |')
        out.append('|---|' + '|'.join('---' for _ in sigs) + '|')
        for conf, m in sw.items():
            out.append(f'| ≥{conf} | ' + ' | '.join(f'{fmt(m[k]["precision"])} / {fmt(m[k]["recall"])}' for k in sigs) + ' |')
        out.append('')
    c = results[0]['cost']
    out.append(f'Production vision model: `{c["production"]["model"]}`, measured **${c["production"]["usd_per_door"]:.4f} per door** '
               f'(imagery + vision over {c["production"]["doors"]} doors). Eval and discovery spend: ${c["eval_and_discovery_usd"]:.2f}. '
               f'By model: ' + ', '.join(f'{m} ${v:.2f}' for m, v in c['by_model'].items()) + '.')
    return '\n'.join(out)

def main():
    files = sorted((DATA / 'eval').glob('results_*.json'))
    results = [json.loads(f.read_text()) for f in files]
    if not results:
        raise SystemExit('no results_*.json; run run_eval first')
    results.sort(key=lambda r: r['model'])
    body = f'{START}\n{render(results)}\n{END}'
    doc = DOC.read_text()
    if START in doc:
        doc = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda _: body, doc, flags=re.S)
    else:
        doc = doc.replace('## Vision eval\n', '## Vision eval\n\n' + body + '\n')
    DOC.write_text(doc)
    print(f'updated {DOC} with {len(results)} model result sets')

if __name__ == '__main__':
    main()
