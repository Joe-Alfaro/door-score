"""Budget cap and cost arithmetic. Uses a temporary ledger so the real one is never touched."""
import json
import pytest
from doorscore import costs


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    p = tmp_path / 'ledger.jsonl'
    monkeypatch.setattr(costs, 'LEDGER', p)
    monkeypatch.setattr(costs, '_total', None)
    monkeypatch.setattr(costs, 'MAX_SPEND_USD', 1.0)
    return p


def rows(p):
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def test_record_under_cap_is_silent(ledger):
    costs.record('vision_llm', 0.4, 'd1', model='claude-sonnet-5-5')
    costs.record('vision_llm', 0.5, 'd2', model='claude-sonnet-5-5')
    assert len(rows(ledger)) == 2 and costs.total_spend() == pytest.approx(0.9)


def test_record_crossing_cap_writes_row_then_raises(ledger):
    costs.record('vision_llm', 0.9, 'd1')
    with pytest.raises(costs.BudgetExceeded):
        costs.record('vision_llm', 0.2, 'd2')   # the call already happened: it must be ledgered
    assert [r['door_id'] for r in rows(ledger)] == ['d1', 'd2']
    with pytest.raises(costs.BudgetExceeded):
        costs.ensure_budget()                   # and nothing further may start


def test_ensure_budget_blocks_a_call_that_would_cross(ledger):
    costs.record('vision_llm', 0.5, 'd1')
    costs.ensure_budget(0.4)
    with pytest.raises(costs.BudgetExceeded):
        costs.ensure_budget(0.6)


def test_total_loads_existing_ledger(ledger):
    ledger.write_text(json.dumps({'stage': 'x', 'usd': 0.25}) + '\n')
    assert costs.total_spend() == pytest.approx(0.25)


def test_llm_cost_prices_cache_and_batch():
    full = costs.llm_cost('claude-sonnet-5-5', 2000, 400)
    assert full == pytest.approx(2000 / 1e6 * 2 + 400 / 1e6 * 10)
    assert costs.llm_cost('claude-sonnet-5-5', 2000, 400, batch=True) == pytest.approx(full / 2)
    cached = costs.llm_cost('claude-sonnet-5-5', 500, 400, cache_read_tokens=1500)
    assert cached == pytest.approx(500 / 1e6 * 2 + 1500 / 1e6 * 2 * 0.1 + 400 / 1e6 * 10)
    assert costs.llm_cost('claude-opus-5-5', 0, 0, cache_read_tokens=1000) == pytest.approx(1000 / 1e6 * 4 * 0.05)


def test_per_call_rate_falls_back_to_measured_profile(ledger):
    """No ledger rows for Haiku on satellite: price the measured token profile at Haiku list price."""
    tin, tout = costs.MEASURED_TOKENS['satellite_vision_llm']
    assert costs.per_call_rate('satellite_vision_llm', 'claude-haiku-4-5') == pytest.approx(tin / 1e6 * 1 + tout / 1e6 * 5)
    assert costs.per_call_rate('satellite_vision_llm', 'claude-haiku-4-5', batch=True) == pytest.approx((tin / 1e6 * 1 + tout / 1e6 * 5) / 2)
