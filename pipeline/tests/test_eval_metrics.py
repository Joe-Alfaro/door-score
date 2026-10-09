"""Unit tests for eval metrics (prf) and the quartile ranker used by the score."""
import pytest

from doorscore.eval.run_eval import prf
from doorscore.score import _pct_rank


# ---- prf ----------------------------------------------------------------------------------
def test_prf_all_zero_yields_none_everywhere():
    assert prf(0, 0, 0) == {'tp': 0, 'fp': 0, 'fn': 0, 'precision': None, 'recall': None, 'f1': None}


def test_prf_perfect():
    res = prf(5, 0, 0)
    assert res['precision'] == 1.0
    assert res['recall'] == 1.0
    assert res['f1'] == 1.0


def test_prf_no_positives_predicted_but_some_missed():
    res = prf(0, 0, 3)
    assert res['precision'] is None   # nothing predicted, precision undefined
    assert res['recall'] == 0.0
    assert res['f1'] is None


def test_prf_only_false_positives():
    res = prf(0, 4, 0)
    assert res['precision'] == 0.0
    assert res['recall'] is None      # no actual positives, recall undefined
    assert res['f1'] is None


def test_prf_mixed_counts():
    res = prf(3, 1, 2)
    assert res['precision'] == pytest.approx(0.75)
    assert res['recall'] == pytest.approx(0.6)
    assert res['f1'] == pytest.approx(2 * 0.75 * 0.6 / (0.75 + 0.6))


def test_prf_echoes_counts():
    res = prf(7, 2, 1)
    assert (res['tp'], res['fp'], res['fn']) == (7, 2, 1)


# ---- _pct_rank ----------------------------------------------------------------------------
CUTS = [100, 200, 300]


@pytest.mark.parametrize(
    ('value', 'expected'),
    [
        (0, 0),
        (99, 0),
        (100, 1),     # boundary is inclusive
        (150, 1),
        (200, 2),
        (299, 2),
        (300, 3),
        (10_000, 3),
    ],
)
def test_pct_rank_quartiles(value, expected):
    assert _pct_rank(value, CUTS) == expected


def test_pct_rank_degenerate_cutpoints():
    # score_doors falls back to [0, 0, 0] when fewer than 4 values exist: every positive value is top.
    assert _pct_rank(1, [0, 0, 0]) == 3
    assert _pct_rank(0, [0, 0, 0]) == 3


def test_pct_rank_empty_cutpoints():
    assert _pct_rank(500, []) == 0
