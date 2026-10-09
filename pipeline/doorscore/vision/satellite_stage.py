"""Run satellite harvest + overhead vision detection for every door; attach results to door records."""
import concurrent.futures as cf
from ..harvest.satellite import harvest, SatelliteAccessError
from .satellite_detect import analyze_image, DEFAULT_MODEL

def run_satellite(doors: list[dict], model: str = DEFAULT_MODEL, limit: int | None = None, workers: int = 4) -> list[dict]:
    try:
        images = harvest(doors, limit=limit)
    except SatelliteAccessError as e:
        # A disabled API is a configuration problem, not a per-door one: report once, score without satellite.
        print(f'[satellite] {e}')
        images = {}
    print(f'[satellite] {len(images)} doors have satellite imagery')
    def work(d):
        info = images.get(d['door_id'])
        if not info:
            return d['door_id'], None
        try:
            res = analyze_image(info['path'], d['door_id'], model=model)
        except Exception as e:  # keep going; one bad image must not kill the run
            print(f'[satellite] {d["address"]}: {e}')
            return d['door_id'], None
        return d['door_id'], {**res, 'image': info}
    with cf.ThreadPoolExecutor(workers) as ex:
        results = dict(ex.map(work, doors[:limit] if limit else doors))
    for d in doors:
        d['satellite'] = results.get(d['door_id'])
    return doors
