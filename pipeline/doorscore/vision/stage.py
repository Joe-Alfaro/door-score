"""Run imagery harvest + vision detection for every door; attach results to door records."""
import concurrent.futures as cf
from ..harvest.streetview import harvest
from .detect import analyze_image, DEFAULT_MODEL

def run_vision(doors: list[dict], model: str = DEFAULT_MODEL, limit: int | None = None, workers: int = 4) -> list[dict]:
    images = harvest(doors, limit=limit)
    print(f'[vision] {len(images)} doors have Street View imagery')
    def work(d):
        info = images.get(d['door_id'])
        if not info:
            return d['door_id'], None
        try:
            res = analyze_image(info['path'], d['door_id'], model=model)
        except Exception as e:  # keep going; one bad image must not kill the run
            print(f'[vision] {d["address"]}: {e}')
            return d['door_id'], None
        return d['door_id'], {**res, 'image': info}
    with cf.ThreadPoolExecutor(workers) as ex:
        results = dict(ex.map(work, doors[:limit] if limit else doors))
    for d in doors:
        d['vision'] = results.get(d['door_id'])
    return doors
