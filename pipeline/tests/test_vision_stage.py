"""Stage behaviour under the spend cap and in batch mode, with every network edge stubbed out."""
import json
from types import SimpleNamespace
import pytest
from doorscore import costs
from doorscore.vision import stage, batch as vb
from doorscore.vision.detect import StreetViewSignals

DOORS = [{'door_id': f'0201_1_{i}', 'address': f'{i} Test St', 'lat': 41.0, 'lng': -74.1} for i in range(6)]
META = {'status': 'OK', 'pano_id': 'PANO', 'location': {'lat': 41.0, 'lng': -74.1}, 'distance_m': 10, 'date': '2025-07'}
CACHED = {'model': 'claude-sonnet-5-5', 'prompt_version': 'v2', 'usd': 0.008, 'signals': {'image_usable': True}}


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    p = tmp_path / 'ledger.jsonl'
    monkeypatch.setattr(costs, 'LEDGER', p)
    monkeypatch.setattr(costs, '_total', None)
    monkeypatch.setattr(costs, 'MAX_SPEND_USD', 0.02)
    return p


@pytest.fixture
def stubbed(monkeypatch, tmp_path):
    """Metadata and images come from nowhere; the first two doors are cached, the rest need the model."""
    img = tmp_path / 'img.jpg'
    img.write_bytes(b'\xff\xd8\xff\xd9')
    monkeypatch.setattr(stage, 'pano_metadata', lambda d: META)
    monkeypatch.setattr(stage, 'image_info', lambda d, m: {'path': str(img), 'pano_id': 'PANO'})
    monkeypatch.setattr(stage, 'fetch_image', lambda d: {'path': str(img), 'pano_id': 'PANO'})
    fake_cache = {'0201_1_0': CACHED, '0201_1_1': CACHED}
    monkeypatch.setattr(stage, 'cached_result', lambda did, pano, model, path=None: fake_cache.get(did))
    monkeypatch.setattr(stage, 'per_call_rate', lambda *a, **k: 0.008)
    return fake_cache


def test_run_vision_stops_cleanly_when_cap_is_crossed(stubbed, ledger, capsys, monkeypatch):
    """Each paid call records $0.008 against a $0.02 cap: the third paid call crosses it, the stage
    stops issuing new calls, keeps every result it already has (including the one that crossed the
    cap, which analyze_sync caches before record() raises), and reports instead of raising."""
    def fake_analyze(path, door_id, model, pano_id, expected_usd):
        stubbed[door_id] = {**CACHED, 'door_id': door_id}      # cache written first, as in analyze_sync
        costs.record('vision_llm', 0.008, door_id, model=model)  # then the ledger row, which may raise
        return stubbed[door_id]
    monkeypatch.setattr(stage, 'analyze_image', fake_analyze)
    doors = stage.run_vision([dict(d) for d in DOORS], batch=False, workers=1)
    paid = [json.loads(l) for l in ledger.read_text().splitlines()]
    assert len(paid) == 3                                  # 0.008 + 0.008 ok, third crosses 0.02 and raises
    with_vision = [d['door_id'] for d in doors if d['vision']]
    assert with_vision == ['0201_1_0', '0201_1_1', '0201_1_2', '0201_1_3', '0201_1_4']  # cached 2 + 3 paid (third was ledgered and cached)
    assert doors[5]['vision'] is None
    out = capsys.readouterr().out
    assert 'STOPPED' in out and 'MAX_SPEND_USD' in out and '1 doors left' in out


class StubBatches:
    """Mimics client.messages.batches: records what was submitted, returns canned results."""
    def __init__(self, signals: dict):
        self.submitted = None
        self.signals = signals
    def create(self, requests):
        self.submitted = requests
        return SimpleNamespace(id='msgbatch_test', processing_status='ended',
                               request_counts=SimpleNamespace(processing=0, succeeded=len(requests), errored=0))
    def retrieve(self, bid):
        return self.create(self.submitted)
    def results(self, bid):
        for r in self.submitted:
            msg = SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.signals))],
                                  usage=SimpleNamespace(input_tokens=2128, output_tokens=421, cache_read_input_tokens=0, cache_creation_input_tokens=0))
            yield SimpleNamespace(custom_id=r['custom_id'], result=SimpleNamespace(type='succeeded', message=msg))


def test_run_batch_caches_and_records_at_half_price(tmp_path, ledger, monkeypatch):
    monkeypatch.setattr(costs, 'MAX_SPEND_USD', 100.0)
    sample = next(iter((stage.__file__ and __import__('pathlib').Path(__file__).resolve().parents[2] / 'data' / 'cache' / 'vision').glob('*_v2_claude-sonnet-5-5.json')), None)
    if sample is None:
        pytest.skip('needs one cached v2 result as a realistic structured output')
    signals = json.loads(sample.read_text())['signals']
    img = tmp_path / 'a.jpg'
    img.write_bytes(b'\xff\xd8\xff\xd9')
    items = [{'custom_id': f'd{i}', 'image_path': str(img), 'door_id': f'd{i}', 'cache_paths': [tmp_path / f'd{i}.json']} for i in range(3)]
    client = SimpleNamespace(messages=SimpleNamespace(batches=StubBatches(signals)))
    out = vb.run_batch(stage='vision_llm', items=items, model='claude-sonnet-5-5', system='S', user_text='U',
                       schema=StreetViewSignals, prompt_version='v2', expected_usd_per_call=0.004, client=client, poll_seconds=0, log=lambda *_: None)
    assert set(out) == {'d0', 'd1', 'd2'}
    full = costs.llm_cost('claude-sonnet-5-5', 2128, 421)
    for i in range(3):
        rec = json.loads((tmp_path / f'd{i}.json').read_text())
        assert rec['signals'] == signals and rec['batch'] is True and rec['usd'] == pytest.approx(full / 2, abs=1e-6)
    rows = [json.loads(l) for l in ledger.read_text().splitlines()]
    assert len(rows) == 3 and all(r['batch'] and r['usd'] == pytest.approx(full / 2, abs=1e-6) for r in rows)
    assert client.messages.batches.submitted[0]['params']['output_config']['format']['type'] == 'json_schema'


def test_run_batch_refuses_to_submit_over_cap(ledger, tmp_path):
    items = [{'custom_id': 'd0', 'image_path': str(tmp_path / 'x.jpg'), 'door_id': 'd0', 'cache_paths': []}]
    (tmp_path / 'x.jpg').write_bytes(b'\xff\xd8\xff\xd9')
    client = SimpleNamespace(messages=SimpleNamespace(batches=StubBatches({})))
    with pytest.raises(costs.BudgetExceeded):
        vb.run_batch(stage='vision_llm', items=items, model='claude-sonnet-5-5', system='S', user_text='U',
                     schema=StreetViewSignals, prompt_version='v2', expected_usd_per_call=0.05, client=client, log=lambda *_: None)
    assert client.messages.batches.submitted is None and not ledger.exists()
