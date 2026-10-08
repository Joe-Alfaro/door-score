"""Source discovery agent.

Given only a territory (municipality / county / state), use Claude with web search to find
public data sources that could enrich a door-level profile, and record each one with its
access method and terms-of-service posture. Output: data/out/sources.json.

Usage: python -m doorscore.discover [--model claude-sonnet-5-5]
Only sources marked tos_ok=true are candidates for harvesting; the harvesters in
doorscore/harvest/ implement the ones we wired. Everything else is documented for reviewers.
"""
import argparse, json
import anthropic
import requests
from .config import OUT, DATA
from .costs import record, llm_cost

REGISTER = {
    'name': 'register_source', 'strict': True,
    'description': 'Record one public data source relevant to profiling homes in the territory. Call once per distinct source.',
    'input_schema': {'type': 'object', 'additionalProperties': False,
        'required': ['name', 'publisher', 'url', 'data_type', 'access', 'fields', 'join_key', 'tos_ok', 'tos_note', 'pii_risk', 'icp_use'],
        'properties': {
            'name': {'type': 'string'}, 'publisher': {'type': 'string'}, 'url': {'type': 'string'},
            'data_type': {'type': 'string', 'enum': ['parcel_tax', 'deeds_sales', 'permits', 'listings', 'imagery', 'census_demographics', 'zoning_landuse', 'code_enforcement', 'utilities_solar', 'flood_environment', 'other']},
            'access': {'type': 'string', 'enum': ['rest_api', 'arcgis_feature_service', 'bulk_download', 'web_portal_only', 'unknown']},
            'fields': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Attributes available per record'},
            'join_key': {'type': 'string', 'description': 'How to join to a parcel: block/lot, address, lat/lng, tract, none'},
            'tos_ok': {'type': 'boolean', 'description': 'True only if programmatic access is clearly permitted (open data license, public API, or explicit download)'},
            'tos_note': {'type': 'string'},
            'pii_risk': {'type': 'string', 'enum': ['none', 'aggregate_only', 'contains_owner_identity', 'unknown']},
            'icp_use': {'type': 'string', 'description': 'Which ICP trait this helps detect: recently moved / dual-income / hires out / needs services / owner-occupied'},
        }}}
WEB_SEARCH = {'type': 'web_search_20260209', 'name': 'web_search', 'max_uses': 25}

SYSTEM = """You are a data-sourcing researcher for a home-services company. You must find PUBLIC data
sources that describe single-family homes in a given territory, for use in a door-level lead score.
Prefer official government open data (state GIS, county/municipal portals, Census, federal agencies)
and public APIs. Do not propose scraping sites whose terms forbid it (e.g. Zillow, Redfin, Realtor.com)
and do not propose any source whose main value is identifying homeowners by name — New Jersey redacts
owner names under Daniel's Law and we will not route around that. For each source you find, call
register_source. Aim for 8-15 distinct, genuinely useful sources. Finish with a short summary."""

def probe(url: str) -> dict:
    try:
        r = requests.head(url, timeout=15, allow_redirects=True)
        if r.status_code >= 400:
            r = requests.get(url, timeout=20, stream=True)
        return {'reachable': r.status_code < 400, 'status': r.status_code}
    except requests.RequestException as e:
        return {'reachable': False, 'status': type(e).__name__}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='claude-sonnet-5-5')
    ap.add_argument('--territory', default='Ramsey Borough and Allendale Borough, Bergen County, New Jersey')
    args = ap.parse_args()
    client = anthropic.Anthropic()
    messages = [{'role': 'user', 'content': f'Territory: {args.territory}. Find public data sources for ~570 single-family homes there.'}]
    sources, usd, turns = [], 0.0, 0
    while turns < 12:
        turns += 1
        resp = client.messages.create(model=args.model, max_tokens=8000, system=SYSTEM,
                                      tools=[WEB_SEARCH, REGISTER], messages=messages)
        usd += llm_cost(args.model, resp.usage.input_tokens, resp.usage.output_tokens)
        messages.append({'role': 'assistant', 'content': resp.content})
        if resp.stop_reason == 'pause_turn':
            continue
        tool_uses = [b for b in resp.content if b.type == 'tool_use']
        if not tool_uses:
            break
        results = []
        for b in tool_uses:
            src = dict(b.input)
            src['probe'] = probe(src['url'])
            sources.append(src)
            print(f'  + {src["name"]} [{src["data_type"]}/{src["access"]}] tos_ok={src["tos_ok"]} reachable={src["probe"]["reachable"]}')
            results.append({'type': 'tool_result', 'tool_use_id': b.id, 'content': 'recorded'})
        messages.append({'role': 'user', 'content': results})
    record('discovery_llm', usd, None, model=args.model)
    summary = ' '.join(b.text for b in resp.content if b.type == 'text')
    # Dedupe by url
    seen, uniq = set(), []
    for s in sources:
        if s['url'] not in seen:
            seen.add(s['url']); uniq.append(s)
    out = {'territory': args.territory, 'model': args.model, 'usd': round(usd, 4), 'summary': summary,
           'wired_in_pipeline': ['NJ Parcels Composite (parcel_tax)', 'Google Street View Static API (imagery)', 'Census ACS 5-year via tract (census_demographics)'],
           'sources': uniq}
    (OUT / 'sources.json').write_text(json.dumps(out, indent=1))
    print(f'\n{len(uniq)} sources -> {OUT/"sources.json"}  (${usd:.3f})\n{summary}')

if __name__ == '__main__':
    main()
