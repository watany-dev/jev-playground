"""フォーム画面のオフライン検証（Jev はスタブに差し替える）。"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from jev_form.app import create_app
from jev_form.gateway import JevClient
from jev_form.prefectures import PREFECTURES, REGIONS


def _stub_response(request: httpx.Request) -> httpx.Response:
    prefecture_probabilities = {p.code: 0.0 for p in PREFECTURES}
    prefecture_probabilities["tottori"] = 1.0
    region_probabilities = {code: 0.0 for code in REGIONS}
    region_probabilities["chugoku"] = 1.0
    return httpx.Response(
        200,
        json={
            "answers": {
                "prefecture": {"type": "choice", "choice": "tottori", "probabilities": prefecture_probabilities},
                "region": {"type": "choice", "choice": "chugoku", "probabilities": region_probabilities},
                "specificity": {"type": "score", "score": 3.0, "probabilities": {"0": 0, "1": 0, "2": 0, "3": 1}},
                "offTopic": {"type": "boolean", "probability": 0.01},
            },
            "usage": {"inputTokens": 900, "outputTokens": 90},
            "providerMetadata": {"gateway": {"cost": "0.00003"}},
        },
    )


@pytest.fixture
def client() -> TestClient:
    jev = JevClient(api_key="test-key", client=httpx.Client(transport=httpx.MockTransport(_stub_response)))
    return TestClient(create_app(jev))


def test_get_renders_the_form_with_all_prefectures(client: TestClient) -> None:
    body = client.get("/").text
    assert body.count("<option") == 48  # 47県 + 未選択
    assert "ヒント" in body


def test_post_shows_the_ranking_and_the_verdict(client: TestClient) -> None:
    body = client.post("/", data={"hint": "砂丘と梨", "guess": "tottori"}).text
    assert "鳥取県" in body
    assert "正解（最有力と一致）" in body
    assert "100.0%" in body


def test_post_without_a_hint_asks_again(client: TestClient) -> None:
    body = client.post("/", data={"hint": "   ", "guess": ""}).text
    assert "ヒントを入力してください" in body


def test_hint_is_escaped_before_rendering(client: TestClient) -> None:
    body = client.post("/", data={"hint": "<script>alert(1)</script>砂丘", "guess": ""}).text
    assert "<script>alert(1)</script>" not in body
    assert "&lt;script&gt;" in body


def test_failures_are_shown_as_a_fixed_category() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"message": "restricted"}})

    jev = JevClient(api_key="test-key", client=httpx.Client(transport=httpx.MockTransport(fail)))
    body = TestClient(create_app(jev)).post("/", data={"hint": "砂丘", "guess": ""}).text
    assert "http-403" in body
    assert "test-key" not in body
