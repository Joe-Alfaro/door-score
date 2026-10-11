"""Run imagery harvest + vision detection for every door; attach results to door records.

Order of operations is what keeps re-runs free: the free Street View metadata resolves the cache key,
so cached doors never touch the image API or the model; only doors without a cached result have their
image fetched (paid) and analyzed (paid, synchronously or as one Message Batch).
"""
import concurrent.futures as cf, os, threading
from ..costs import BudgetExceeded, per_call_rate
from ..harvest.streetview import pano_metadata, image_info, fetch_image
from .detect import analyze_image, cached_result, cache_paths, DEFAULT_MODEL, STAGE, SYSTEM, USER_TEXT, StreetViewSignals, PROMPT_VERSION


def batch_enabled(batch: bool | None) -> bool:
    return bool(int(os.getenv('VISION_BATCH', '0'))) if batch is None else batch


def run_vision(doors: list[dict], model: str = DEFAULT_MODEL, limit: int | None = None, workers: int = 4,
               batch: bool | None = None, cache_only: bool = False) -> list[dict]:
    batch = batch_enabled(batch)
    subset = doors[:limit] if limit else doors
    results, pending = {}, []
    for d in subset:
        try:
            meta = pano_metadata(d)   # free; cached after the first run
        except Exception as e:
            print(f'[vision] {d["address"]}: metadata {e}')
            continue
        info = image_info(d, meta)
        if not info:
            continue
        cached = cached_result(d['door_id'], info['pano_id'], model, info['path'])
        if cached:
            results[d['door_id']] = {**cached, 'image': info}
        else:
            pending.append(d)
    print(f'[vision] {len(results)} doors served from cache, {len(pending)} need imagery + model')
    if cache_only and pending:
        # Public / grader runs: never spend. Doors without a cached result simply have no vision signals.
        print(f'[vision] cache-only mode: {len(pending)} doors skipped (no imagery fetched, no model calls)')
        pending = []
    rate = per_call_rate(STAGE, model, batch=batch)
    stop, budget_msgs = threading.Event(), []

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
            res = analyze_image(info['path'], d['door_id'], model=model, pano_id=info['pano_id'], expected_usd=rate)
        except BudgetExceeded as e:
            # The call that crossed the cap was paid for and cached before record() raised: keep it.
            stop.set()
            budget_msgs.append(str(e))
            res = cached_result(d['door_id'], info['pano_id'], model, info['path']) if info else None
            return d['door_id'], ({**res, 'image': info} if res else None)
        except Exception as e:  # keep going; one bad image must not kill the run
            print(f'[vision] {d["address"]}: {e}')
            return d['door_id'], None
        return d['door_id'], {**res, 'image': info}

    with cf.ThreadPoolExecutor(workers) as ex:
        fetched = dict(ex.map(work, pending))
    if batch and not stop.is_set():
        from .batch import run_batch
        items = [{'custom_id': did, 'image_path': r['image']['path'], 'door_id': did,
                  'cache_paths': cache_paths(did, r['image']['pano_id'], model, r['image']['path'])}
                 for did, r in fetched.items() if r]
        try:
            got = run_batch(stage=STAGE, items=items, model=model, system=SYSTEM, user_text=USER_TEXT, schema=StreetViewSignals,
                            prompt_version=PROMPT_VERSION, expected_usd_per_call=rate)
        except BudgetExceeded as e:
            budget_msgs.append(str(e))
            got = {did: cached_result(did, r['image']['pano_id'], model, r['image']['path']) for did, r in fetched.items() if r}
        fetched = {did: ({**got[did], 'image': r['image']} if r and got.get(did) else None) for did, r in fetched.items()}
    results.update({k: v for k, v in fetched.items() if v})
    if budget_msgs:
        missing = sum(1 for d in pending if d['door_id'] not in results)
        print(f'[vision] STOPPED: {budget_msgs[0]}. {missing} doors left without vision; raise MAX_SPEND_USD to continue.')
    for d in doors:
        d['vision'] = results.get(d['door_id'])
    return doors
