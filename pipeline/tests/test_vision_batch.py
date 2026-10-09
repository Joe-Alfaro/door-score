"""Batch request construction and result parsing, with no network and no API key."""
import base64, json
from pathlib import Path
import pytest
from doorscore.vision import batch as vb
from doorscore.vision.detect import StreetViewSignals, SYSTEM, USER_TEXT, PROMPT_VERSION
from doorscore.vision.satellite_detect import SatelliteSignals

REPO = Path(__file__).resolve().parents[2]
CACHED_IMAGES = sorted((REPO / 'data' / 'cache' / 'streetview').glob('*.jpg'))[:3]
# Smallest valid-looking JPEG header; the builder only base64-encodes bytes, it never decodes them.
FAKE_JPEG = b'\xff\xd8\xff\xe0' + b'\x00' * 64 + b'\xff\xd9'


@pytest.fixture
def images(tmp_path):
    if len(CACHED_IMAGES) == 3:
        return CACHED_IMAGES
    paths = []
    for i in range(3):
        p = tmp_path / f'0201_1_{i}.jpg'
        p.write_bytes(FAKE_JPEG)
        paths.append(p)
    return paths


def test_build_requests_shape(images):
    items = [{'custom_id': p.stem, 'image_path': str(p)} for p in images]
    reqs = vb.build_requests(items, 'claude-sonnet-5-5', SYSTEM, USER_TEXT, StreetViewSignals)
    assert [r['custom_id'] for r in reqs] == [p.stem for p in images]
    for r, p in zip(reqs, images):
        params = r['params']
        assert set(params) == {'model', 'max_tokens', 'system', 'messages', 'output_config'}
        assert params['model'] == 'claude-sonnet-5-5' and params['max_tokens'] == 1500
        # system is a block list with the cache breakpoint on the shared prefix
        assert params['system'][0]['text'] == SYSTEM and params['system'][0]['cache_control'] == {'type': 'ephemeral'}
        image_block, text_block = params['messages'][0]['content']
        assert image_block['type'] == 'image' and image_block['source']['media_type'] == 'image/jpeg'
        assert base64.standard_b64decode(image_block['source']['data']) == p.read_bytes()
        assert text_block == {'type': 'text', 'text': USER_TEXT}
        fmt = params['output_config']['format']
        assert fmt['type'] == 'json_schema'
        assert set(StreetViewSignals.model_fields) <= set(fmt['schema']['properties'])
    # the whole list must be JSON-serialisable exactly as the SDK will send it
    json.dumps(reqs)


def test_output_format_matches_sdk_transform():
    """The batch path must send the same schema messages.parse() sends, or results could differ."""
    from anthropic.lib._parse._transform import transform_schema
    assert vb.output_format(SatelliteSignals)['schema'] == transform_schema(SatelliteSignals)


def test_cached_result_round_trips_through_schema():
    """A result in the cache format validates with the same model the batch path uses."""
    sample = next(iter((REPO / 'data' / 'cache' / 'vision').glob('*_v2_claude-sonnet-5-5.json')), None)
    if sample is None:
        pytest.skip('no cached vision results in this checkout')
    signals = StreetViewSignals.model_validate(json.loads(sample.read_text())['signals'])
    assert signals.model_dump() == json.loads(sample.read_text())['signals']


def test_custom_ids_are_valid_door_ids(images):
    """Batch custom_ids must match ^[a-zA-Z0-9_-]{1,64}$; door_ids like 0201_101_31 qualify."""
    import re
    items = [{'custom_id': p.stem, 'image_path': str(p)} for p in images]
    for r in vb.build_requests(items, 'claude-haiku-4-5', SYSTEM, USER_TEXT, StreetViewSignals):
        assert re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', r['custom_id'])


def test_prompt_version_default_is_v2():
    assert PROMPT_VERSION == 'v2'
