"""Run satellite harvest + overhead vision detection for every door; attach results to door records.

Cache first: a door whose (door_id, zoom, prompt version, model) result exists is served without the
tile on disk; only uncached doors fetch a tile (paid) and call the model (paid, sync or batch).
"""
import concurrent.futures as cf, threading
from ..costs import BudgetExceeded, per_call_rate
from ..harvest.satellite import fetch_image, image_info, SatelliteAccessError, ZOOM
from .satellite_detect import analyze_image, cached_result, cache_paths, DEFAULT_MODEL, STAGE, SYSTEM, USER_TEXT, SatelliteSignals, PROMPT_VERSION
from .stage import batch_enabled


def run_satellite(doors: list[dict], model: str = DEFAULT_MODEL, limit: int | None = None, workers: int = 4,
                  batch: bool | None = None) -> list[dict]:
    batch = batch_enabled(batch)
    subset = doors[:limit] if limit else doors
    results, pending = {}, []
    for d in subset:
        info = image_info(d)
        cached = cached_result(d['door_id'], ZOOM, model, info['path'])
        if cached:
            results[d['door_id']] = {**cached, 'image': info}
        else:
            pending.append(d)
    print(f'[satellite] {len(results)} doors served from cache, {len(pending)} need a tile + model')
    rate = per_call_rate(STAGE, model, batch=batch)
    stop, budget_msgs, access_msgs = threading.Event(), [], []

    def work(d):
        if stop.is_set():
            return d['door_id'], None
        info = None
        try:
            info = fetch_image(d)   # may itself raise BudgetExceeded: the image fetch is a paid call too
            if not info:
                return d['door_id'], None
            if batch:
                return d['door_id'], {'image': info, 'pending': True}
            res = analyze_image(info['path'], d['door_id'], model=model, zoom=ZOOM, expected_usd=rate)
        except SatelliteAccessError as e:
            # A disabled API is a configuration problem, not a per-door one: report once, score without satellite.
            stop.set()
            access_msgs.append(str(e))
            return d['door_id'], None
        except BudgetExceeded as e:
            # The call that crossed the cap was paid for and cached before record() raised: keep it.
            stop.set()
            budget_msgs.append(str(e))
            res = cached_result(d['door_id'], ZOOM, model, info['path']) if info else None
            return d['door_id'], ({**res, 'image': info} if res else None)
        except Exception as e:  # keep going; one bad image must not kill the run
            print(f'[satellite] {d["address"]}: {e}')
            return d['door_id'], None
        return d['door_id'], {**res, 'image': info}

    with cf.ThreadPoolExecutor(workers) as ex:
        fetched = dict(ex.map(work, pending))
    if batch and not stop.is_set():
        from .batch import run_batch
        items = [{'custom_id': did, 'image_path': r['image']['path'], 'door_id': did,
                  'cache_paths': cache_paths(did, ZOOM, model, r['image']['path'])}
                 for did, r in fetched.items() if r]
        try:
            got = run_batch(stage=STAGE, items=items, model=model, system=SYSTEM, user_text=USER_TEXT, schema=SatelliteSignals,
                            prompt_version=PROMPT_VERSION, expected_usd_per_call=rate)
        except BudgetExceeded as e:
            budget_msgs.append(str(e))
            got = {did: cached_result(did, ZOOM, model, r['image']['path']) for did, r in fetched.items() if r}
        fetched = {did: ({**got[did], 'image': r['image']} if r and got.get(did) else None) for did, r in fetched.items()}
    results.update({k: v for k, v in fetched.items() if v})
    if access_msgs:
        print(f'[satellite] {access_msgs[0]}')
    if budget_msgs:
        missing = sum(1 for d in pending if d['door_id'] not in results)
        print(f'[satellite] STOPPED: {budget_msgs[0]}. {missing} doors left without satellite; raise MAX_SPEND_USD to continue.')
    for d in doors:
        d['satellite'] = results.get(d['door_id'])
    return doors
