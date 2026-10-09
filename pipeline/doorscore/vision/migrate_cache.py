"""One-off, idempotent migration: duplicate every image-hash-keyed vision result under its metadata key.

Street-level: `<sha1>_<version>_<model>.json` -> `<door_id>+<pano_id>_<version>_<model>.json`, where
pano_id comes from the cached (free) Street View metadata. Satellite: -> `<door_id>_z<zoom>_...`.
Needs the image files once (to compute the hash); afterwards the pipeline runs from the metadata
keys alone. Makes no API call of any kind. Old files are kept: they are the fallback key and what
the eval harness uses. Usage: python -m doorscore.vision.migrate_cache
"""
import json, shutil
from pathlib import Path
from ..config import CACHE, DATA
from ..harvest.streetview import META_DIR, IMG_DIR as SV_DIR
from ..harvest.satellite import IMG_DIR as SAT_DIR, ZOOM
from .common import image_hash
from . import detect, satellite_detect


def _copy_by_hash(out_dir: Path, h: str, rename) -> tuple[int, int]:
    """Copy every `<h>_<rest>.json` to `rename(rest)`. Returns (copied, already_present)."""
    copied = present = 0
    for src in out_dir.glob(f'{h}_*.json'):
        dst = out_dir / rename(src.name[len(h) + 1:])
        if dst.exists():
            present += 1
            continue
        shutil.copyfile(src, dst)
        copied += 1
    return copied, present


def migrate_streetview() -> dict:
    stats = {'doors': 0, 'copied': 0, 'present': 0, 'no_image': 0}
    for meta_p in sorted(META_DIR.glob('*.json')):
        meta = json.loads(meta_p.read_text())
        door_id, pano_id = meta_p.stem, meta.get('pano_id')
        if meta.get('status') != 'OK' or not pano_id:
            continue
        stats['doors'] += 1
        # The eval sample keeps its own copy of some images; hash both so every stored result migrates.
        images = [p for p in (SV_DIR / f'{door_id}.jpg', DATA / 'eval' / 'images' / f'{door_id}.jpg') if p.exists()]
        if not images:
            stats['no_image'] += 1
            continue
        for h in {image_hash(str(p)) for p in images}:
            c, p = _copy_by_hash(detect.OUT_DIR, h, lambda rest: f'{door_id}+{pano_id}_{rest}')
            stats['copied'] += c
            stats['present'] += p
    return stats


def migrate_satellite() -> dict:
    stats = {'tiles': 0, 'copied': 0, 'present': 0}
    for img in sorted(SAT_DIR.glob('*.*')):
        door_id = img.stem
        stats['tiles'] += 1
        c, p = _copy_by_hash(satellite_detect.OUT_DIR, image_hash(str(img)), lambda rest: f'{door_id}_z{ZOOM}_{rest}')
        stats['copied'] += c
        stats['present'] += p
    return stats


def main():
    print('[migrate] street-level', migrate_streetview())
    print('[migrate] satellite   ', migrate_satellite())


if __name__ == '__main__':
    main()
