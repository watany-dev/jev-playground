"""Vercel AI Gateway の evaluation-model エンドポイントへの最小クライアント。

Python 版の AI SDK は無いため、`@ai-sdk/gateway@4.0.85` が実際に送受信する
形（`POST {baseURL}/evaluation-model`、仕様バージョン4ヘッダ、`{state, questions}`）
をそのまま実装する。応答検証は `ai@7.0.105` の `experimental_evaluate` と同じ
規則を移植している。検証を省くと、確率の欠損や型違いを正常な判定として
扱ってしまうためである。

APIキーは環境変数からのみ読み、ファイルにもログにも残さない。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai"
DEFAULT_MODEL_ID = "typesafe-ai/jev"
SPECIFICATION_VERSION = "4"
TOLERANCE = 1e-6

QuestionType = Literal["boolean", "choice", "score"]


class JevError(Exception):
    """Jev 呼び出しの失敗。`category` は外へ出しても安全な固定語のみ。"""

    def __init__(self, category: str, detail: str = "") -> None:
        super().__init__(f"{category}: {detail}" if detail else category)
        self.category = category
        self.detail = detail


@dataclass(frozen=True)
class Question:
    type: QuestionType
    instructions: str
    # choice: {option: 説明} / score: [段階の説明, ...] / boolean: None か {"true"/"false": 説明}
    criteria: dict[str, str] | list[str] | None = None

    def payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {"type": self.type, "instructions": self.instructions}
        if self.criteria is not None:
            body["criteria"] = self.criteria
        return body

    def keys(self) -> list[str]:
        if self.type == "choice":
            assert isinstance(self.criteria, dict)
            return list(self.criteria)
        if self.type == "score":
            assert isinstance(self.criteria, list)
            return [str(i) for i in range(len(self.criteria))]
        return []


@dataclass(frozen=True)
class Answer:
    type: QuestionType
    probabilities: dict[str, float] = field(default_factory=dict)
    choice: str | None = None
    score: float | None = None
    probability: float | None = None

    def ranked(self) -> list[tuple[str, float]]:
        return sorted(self.probabilities.items(), key=lambda kv: kv[1], reverse=True)


@dataclass(frozen=True)
class Evaluation:
    answers: dict[str, Answer]
    usage: dict[str, int]
    cost: float | None
    warnings: list[dict[str, Any]]


def _is_probability(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0.0 <= float(value) <= 1.0


def _rounding_error(decimals: Any) -> float:
    if decimals is None:
        return 0.0
    if not isinstance(decimals, int) or isinstance(decimals, bool) or not 0 <= decimals <= 15:
        raise JevError("invalid-answer", "rounding decimals must be an integer in [0, 15]")
    return 0.5 * 10.0**-decimals


def _distribution(raw: Any, keys: list[str], error: float) -> dict[str, float]:
    if not isinstance(raw, dict) or set(raw) != set(keys) or not all(_is_probability(v) for v in raw.values()):
        raise JevError("invalid-answer", "incomplete probability distribution")
    values = {k: float(raw[k]) for k in keys}
    if abs(sum(values.values()) - 1.0) > TOLERANCE + len(keys) * error:
        raise JevError("invalid-answer", "probabilities must sum to 1")
    return values


def decode(body: Any, questions: dict[str, Question]) -> Evaluation:
    """Gateway の応答本文を検証して `Evaluation` に変換する。"""
    if not isinstance(body, dict) or not isinstance(body.get("answers"), dict):
        raise JevError("invalid-answer", "missing answers")
    raw_answers: dict[str, Any] = body["answers"]
    if set(raw_answers) != set(questions):
        raise JevError("invalid-answer", "answers must cover exactly the asked questions")

    rounding = body.get("rounding") or {}
    probability_error = _rounding_error(rounding.get("probabilityDecimals"))
    score_error = _rounding_error(rounding.get("scoreDecimals"))

    answers: dict[str, Answer] = {}
    for qid, question in questions.items():
        raw = raw_answers[qid]
        if not isinstance(raw, dict) or raw.get("type") != question.type:
            raise JevError("invalid-answer", f'question "{qid}" has the wrong answer type')

        if question.type == "boolean":
            if not _is_probability(raw.get("probability")):
                raise JevError("invalid-answer", f'question "{qid}" must return P(true)')
            answers[qid] = Answer(type="boolean", probability=float(raw["probability"]))
            continue

        keys = question.keys()
        distribution = _distribution(raw.get("probabilities"), keys, probability_error)

        if question.type == "choice":
            choice = raw.get("choice")
            if not isinstance(choice, str) or choice not in keys:
                raise JevError("invalid-answer", f'question "{qid}" selected an unknown option')
            if any(p > distribution[choice] + TOLERANCE for p in distribution.values()):
                raise JevError("invalid-answer", f'question "{qid}" did not select the highest-probability option')
            answers[qid] = Answer(type="choice", choice=choice, probabilities=distribution)
            continue

        score = raw.get("score")
        if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= len(keys) - 1:
            raise JevError("invalid-answer", f'question "{qid}" score is out of range')
        mean = sum(int(k) * p for k, p in distribution.items())
        mean_error = sum(int(k) * probability_error for k in keys)
        if abs(mean - float(score)) > TOLERANCE + mean_error + score_error:
            raise JevError("invalid-answer", f'question "{qid}" score must equal the weighted mean')
        answers[qid] = Answer(type="score", score=float(score), probabilities=distribution)

    usage_raw = body.get("usage") or {}
    usage = {k: int(v) for k, v in usage_raw.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    gateway_meta = (body.get("providerMetadata") or {}).get("gateway") or {}
    cost = gateway_meta.get("cost")
    try:
        cost_value = float(cost) if cost is not None and cost != "" else None
    except (TypeError, ValueError):
        cost_value = None
    warnings = body.get("warnings") or []
    return Evaluation(answers=answers, usage=usage, cost=cost_value, warnings=list(warnings))


def error_category(error: Exception) -> str:
    """例外を、画面やログへ出してよい固定カテゴリへ落とす。"""
    if isinstance(error, JevError):
        return error.category
    if isinstance(error, httpx.TimeoutException):
        return "timeout"
    if isinstance(error, httpx.HTTPStatusError):
        return f"http-{error.response.status_code}"
    if isinstance(error, httpx.HTTPError):
        return "network-error"
    return "provider-error"


@dataclass
class JevClient:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model_id: str = DEFAULT_MODEL_ID
    timeout_s: float = 20.0
    client: httpx.Client | None = None

    @classmethod
    def from_env(cls, **kwargs: Any) -> "JevClient":
        key = os.environ.get("AI_GATEWAY_API_KEY", "").strip()
        if not key:
            raise JevError("missing-api-key", "set AI_GATEWAY_API_KEY")
        return cls(api_key=key, **kwargs)

    def evaluate(self, state: Any, questions: dict[str, Question]) -> Evaluation:
        if not questions:
            raise JevError("invalid-request", "questions must not be empty")
        payload = {
            "state": state,
            "questions": {qid: q.payload() for qid, q in questions.items()},
            # 検証済みのプロバイダーのみに固定する（jev-auto/docs/REPORT.md と同じ方針）。
            "providerOptions": {"gateway": {"only": ["typesafe-ai"]}},
        }
        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
            "ai-evaluation-model-specification-version": SPECIFICATION_VERSION,
            "ai-model-id": self.model_id,
        }
        client = self.client or httpx.Client(timeout=self.timeout_s)
        try:
            response = client.post(f"{self.base_url}/evaluation-model", json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()
        finally:
            if self.client is None:
                client.close()
        return decode(body, questions)
