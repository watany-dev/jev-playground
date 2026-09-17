"""質問セットと結果整形のオフライン検証。"""

from __future__ import annotations

import pytest

from jev_form.gateway import decode
from jev_form.prefectures import PREFECTURES, REGIONS
from jev_form.quiz import SPECIFICITY_LEVELS, build_questions, build_state, summarize


def _score_distribution(score: float) -> dict[str, float]:
    """`score` を重み付き平均として再現する、隣接2段階の分布を作る。"""
    low = int(score)
    high = min(low + 1, len(SPECIFICITY_LEVELS) - 1)
    upper = score - low
    return {
        str(i): (1 - upper if i == low else upper if i == high else 0.0) if low != high else float(i == low)
        for i in range(len(SPECIFICITY_LEVELS))
    }


def _evaluation(top: str, second: str, region: str, score: float = 2.4, off_topic: float = 0.01):
    questions = build_questions()
    prefecture_probabilities = {p.code: 0.0 for p in PREFECTURES}
    prefecture_probabilities[top] = 0.7
    prefecture_probabilities[second] = 0.3
    region_probabilities = {code: 0.0 for code in REGIONS}
    region_probabilities[region] = 1.0
    body = {
        "answers": {
            "prefecture": {"type": "choice", "choice": top, "probabilities": prefecture_probabilities},
            "region": {"type": "choice", "choice": region, "probabilities": region_probabilities},
            "specificity": {"type": "score", "score": score, "probabilities": _score_distribution(score)},
            "offTopic": {"type": "boolean", "probability": off_topic},
        },
        "usage": {"inputTokens": 900, "outputTokens": 90},
    }
    return decode(body, questions)


def test_questions_cover_every_prefecture_and_region() -> None:
    questions = build_questions()
    assert len(questions["prefecture"].criteria) == 47
    assert len(questions["region"].criteria) == 8
    assert len(questions["specificity"].criteria) == len(SPECIFICITY_LEVELS)
    assert questions["offTopic"].criteria is None


def test_state_separates_hint_and_guess() -> None:
    assert build_state("砂丘", "鳥取県") == {
        "task": "日本の47都道府県のうち、ヒントが指す1つを推定する",
        "hint": "砂丘",
        "userGuess": "鳥取県",
    }
    assert "userGuess" not in build_state("砂丘")


def test_summary_ranks_candidates_and_scores_an_exact_guess() -> None:
    result = summarize("砂丘と梨", _evaluation("tottori", "shimane", "chugoku"), guess_code="tottori")
    assert result.top_prefecture == "鳥取県"
    assert result.top_probability == pytest.approx(0.7)
    assert [c.name for c in result.candidates][:2] == ["鳥取県", "島根県"]
    assert result.guess_verdict == "正解（最有力と一致）"
    assert result.guess_probability == pytest.approx(0.7)
    assert result.reliable


def test_same_region_guess_counts_as_close() -> None:
    result = summarize("砂丘と梨", _evaluation("tottori", "shimane", "chugoku"), guess_code="shimane")
    assert result.guess_verdict == "惜しい（同じ地方）"


def test_distant_guess_without_probability_is_reported_as_far() -> None:
    result = summarize("砂丘と梨", _evaluation("tottori", "shimane", "chugoku"), guess_code="okinawa")
    assert result.guess_verdict == "遠い"
    assert result.guess_probability == pytest.approx(0.0)


def test_other_region_guess_with_probability_is_kept_as_possible() -> None:
    result = summarize("うどん", _evaluation("kagawa", "osaka", "shikoku"), guess_code="osaka")
    assert result.guess_verdict == "可能性は残る（確率10%以上）"


def test_thin_hint_is_flagged_as_unreliable() -> None:
    result = summarize("あ", _evaluation("tokyo", "osaka", "kanto", score=0.0, off_topic=0.9))
    assert not result.reliable
    assert result.specificity_label.startswith("0 特定不能")
    assert result.guess_verdict is None
