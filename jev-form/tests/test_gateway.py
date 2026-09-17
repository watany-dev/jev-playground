"""Gateway クライアントの検証規則（AI SDK と同じ）をオフラインで確認する。"""

from __future__ import annotations

import httpx
import pytest

from jev_form.gateway import JevClient, JevError, Question, decode

QUESTIONS = {
    "prefecture": Question(type="choice", instructions="どこ", criteria={"tottori": "鳥取", "shimane": "島根"}),
    "specificity": Question(type="score", instructions="絞り込み度", criteria=["低", "中", "高"]),
    "offTopic": Question(type="boolean", instructions="無関係か"),
}

BODY = {
    "answers": {
        "prefecture": {"type": "choice", "choice": "tottori", "probabilities": {"tottori": 0.9, "shimane": 0.1}},
        "specificity": {"type": "score", "score": 1.7, "probabilities": {"0": 0.0, "1": 0.3, "2": 0.7}},
        "offTopic": {"type": "boolean", "probability": 0.02},
    },
    "usage": {"inputTokens": 700, "outputTokens": 80},
    "providerMetadata": {"gateway": {"cost": "0.000028"}},
}


def test_decode_accepts_a_well_formed_response() -> None:
    evaluation = decode(BODY, QUESTIONS)
    assert evaluation.answers["prefecture"].choice == "tottori"
    assert evaluation.answers["prefecture"].ranked()[0] == ("tottori", 0.9)
    assert evaluation.answers["specificity"].score == pytest.approx(1.7)
    assert evaluation.answers["offTopic"].probability == pytest.approx(0.02)
    assert evaluation.usage == {"inputTokens": 700, "outputTokens": 80}
    assert evaluation.cost == pytest.approx(2.8e-05)


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda b: b["answers"].pop("offTopic"), id="missing-answer"),
        pytest.param(
            lambda b: b["answers"]["prefecture"]["probabilities"].update({"shimane": 0.5}), id="sum-not-one"
        ),
        pytest.param(
            lambda b: b["answers"]["prefecture"].update(
                {"choice": "shimane", "probabilities": {"tottori": 0.9, "shimane": 0.1}}
            ),
            id="not-argmax",
        ),
        pytest.param(lambda b: b["answers"]["prefecture"].update({"choice": "kyoto"}), id="unknown-option"),
        pytest.param(lambda b: b["answers"]["specificity"].update({"score": 0.2}), id="score-not-mean"),
        pytest.param(lambda b: b["answers"]["offTopic"].update({"probability": 1.4}), id="probability-out-of-range"),
        pytest.param(lambda b: b["answers"]["offTopic"].update({"type": "choice"}), id="wrong-type"),
    ],
)
def test_decode_rejects_broken_responses(mutate) -> None:
    import copy

    body = copy.deepcopy(BODY)
    mutate(body)
    with pytest.raises(JevError) as raised:
        decode(body, QUESTIONS)
    assert raised.value.category == "invalid-answer"


def test_decode_allows_declared_rounding_slack() -> None:
    import copy

    body = copy.deepcopy(BODY)
    body["rounding"] = {"probabilityDecimals": 2, "scoreDecimals": 2}
    body["answers"]["prefecture"]["probabilities"] = {"tottori": 0.89, "shimane": 0.1}
    assert decode(body, QUESTIONS).answers["prefecture"].choice == "tottori"


def test_evaluate_sends_the_gateway_wire_format() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=BODY)

    client = JevClient(api_key="test-key", client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.evaluate({"hint": "砂丘と梨"}, QUESTIONS)

    assert seen["url"] == "https://ai-gateway.vercel.sh/v4/ai/evaluation-model"
    headers = seen["headers"]
    assert headers["authorization"] == "Bearer test-key"
    assert headers["ai-model-id"] == "typesafe-ai/jev"
    assert headers["ai-evaluation-model-specification-version"] == "4"
    body = seen["body"]
    assert body["state"] == {"hint": "砂丘と梨"}
    assert body["providerOptions"] == {"gateway": {"only": ["typesafe-ai"]}}
    assert body["questions"]["prefecture"]["criteria"] == {"tottori": "鳥取", "shimane": "島根"}
    assert "criteria" not in body["questions"]["offTopic"]


def test_from_env_requires_a_key(monkeypatch) -> None:
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    with pytest.raises(JevError) as raised:
        JevClient.from_env()
    assert raised.value.category == "missing-api-key"
