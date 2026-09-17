"""47都道府県当てフォーム（FastAPI）。

画面は1枚。ヒントを入力し、任意で自分の予想都道府県を選ぶと、Jev の
確率分布をそのまま表示する。テンプレートエンジンは使わず、標準ライブラリの
エスケープだけで組み立てる。入力はすべて未信頼として扱い、`html.escape` を
通してから描画する。
"""

from __future__ import annotations

import html
from typing import Annotated

from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse

from .gateway import JevClient, error_category
from .prefectures import BY_CODE, PREFECTURES
from .quiz import QuizResult, build_questions, build_state, summarize

MAX_HINT_CHARS = 400

STYLE = """
:root { color-scheme: light dark; --fg:#1b1b1f; --bg:#fbfbfd; --muted:#5b5b66; --bar:#3d6fd8; --line:#d7d7e0; }
@media (prefers-color-scheme: dark) { :root { --fg:#ececf1; --bg:#16161a; --muted:#a2a2ae; --bar:#7aa2f7; --line:#33333d; } }
* { box-sizing: border-box; }
body { margin:0; padding:32px 16px; background:var(--bg); color:var(--fg);
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; line-height:1.6; }
main { max-width: 720px; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 4px; }
p.lead { color: var(--muted); margin-top: 0; }
form { display: grid; gap: 12px; margin-bottom: 28px; }
textarea, select, button { font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
textarea { min-height: 96px; resize: vertical; }
button { background: var(--bar); color: #fff; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; justify-self: start; }
label { font-size: .9rem; color: var(--muted); }
.row { display: grid; gap: 4px; }
.bars { display: grid; gap: 6px; margin: 8px 0 20px; }
.bar { display: grid; grid-template-columns: 7rem 1fr 4rem; align-items: center; gap: 8px; }
.track { background: var(--line); border-radius: 4px; height: 10px; overflow: hidden; }
.fill { background: var(--bar); height: 100%; }
.meta, .error { border: 1px solid var(--line); border-radius: 8px; padding: 12px; font-size: .9rem; color: var(--muted); }
.verdict { font-size: 1.05rem; font-weight: 600; }
.warn { border-left: 4px solid #d08b12; padding-left: 10px; }
"""


def _percent(p: float) -> str:
    return f"{p * 100:.1f}%"


def _bars(items: list[tuple[str, float]]) -> str:
    rows = []
    for name, probability in items:
        width = max(0.0, min(1.0, probability)) * 100
        rows.append(
            f'<div class="bar"><span>{html.escape(name)}</span>'
            f'<span class="track"><span class="fill" style="width:{width:.1f}%"></span></span>'
            f"<span>{_percent(probability)}</span></div>"
        )
    return f'<div class="bars">{"".join(rows)}</div>'


def _form(hint: str = "", guess_code: str = "") -> str:
    options = ['<option value="">（任意）自分の予想</option>']
    for p in PREFECTURES:
        selected = " selected" if p.code == guess_code else ""
        options.append(f'<option value="{p.code}"{selected}>{html.escape(p.name)}</option>')
    return (
        '<form method="post" action="/">'
        '<div class="row"><label for="hint">ヒント（その都道府県を説明する文。地名を直接書いてもよい）</label>'
        f'<textarea id="hint" name="hint" maxlength="{MAX_HINT_CHARS}" required '
        'placeholder="例: 砂丘があって、梨が名産。人口は日本で一番少ない。">'
        f"{html.escape(hint)}</textarea></div>"
        '<div class="row"><label for="guess">予想（選ぶと近さを判定します）</label>'
        f'<select id="guess" name="guess">{"".join(options)}</select></div>'
        "<button type=\"submit\">Jev に判定させる</button>"
        "</form>"
    )


def _result(result: QuizResult) -> str:
    parts = []
    if result.guess_verdict:
        parts.append(
            f'<p class="verdict">あなたの予想: {html.escape(result.guess_name or "")} → {html.escape(result.guess_verdict)}'
            f"（その県の確率 {_percent(result.guess_probability or 0.0)}）</p>"
        )
    parts.append(
        f'<p class="verdict">Jev の最有力: {html.escape(result.top_prefecture)}'
        f"（{_percent(result.top_probability)}）</p>"
    )
    parts.append("<h2>都道府県の確率（上位）</h2>")
    parts.append(_bars([(c.name, c.probability) for c in result.candidates]))
    parts.append(
        '<div class="meta">'
        f"地方: {html.escape(result.region_name)}（{_percent(result.region_probability)}）<br>"
        f"ヒントの絞り込み度: {result.specificity:.2f} / 3 — {html.escape(result.specificity_label)}<br>"
        f"地理と無関係な入力である確率: {_percent(result.off_topic)}<br>"
        f"トークン: {result.usage.get('inputTokens', '-')} in / {result.usage.get('outputTokens', '-')} out"
        + (f"、課金額: ${result.cost:.8f}" if result.cost is not None else "")
        + "</div>"
    )
    if not result.reliable:
        parts.append(
            '<p class="meta warn">ヒントの情報が乏しいか、地理と無関係な可能性が高い。'
            "この判定は参考値として扱う。</p>"
        )
    return "".join(parts)


def _page(body: str) -> HTMLResponse:
    return HTMLResponse(
        "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">"
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>47都道府県あてフォーム (Jev)</title><style>{STYLE}</style></head><body><main>"
        "<h1>47都道府県あてフォーム</h1>"
        '<p class="lead">ヒントを Jev（typesafe-ai/jev）に渡し、47都道府県の確率分布として判定します。</p>'
        f"{body}</main></body></html>"
    )


def create_app(client: JevClient | None = None) -> FastAPI:
    app = FastAPI(title="jev-form")
    questions = build_questions()

    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        return _page(_form())

    @app.post("/", response_class=HTMLResponse)
    def evaluate(
        hint: Annotated[str, Form()],
        guess: Annotated[str, Form()] = "",
    ) -> HTMLResponse:
        hint = hint.strip()[:MAX_HINT_CHARS]
        guess_code = guess if guess in BY_CODE else None
        if not hint:
            return _page(_form(guess_code=guess_code or "") + '<p class="error">ヒントを入力してください。</p>')
        try:
            jev = client or JevClient.from_env()
            evaluation = jev.evaluate(build_state(hint, BY_CODE[guess_code].name if guess_code else None), questions)
            result = summarize(hint, evaluation, guess_code)
        except Exception as error:  # 失敗理由は固定カテゴリへ畳んでから表示する
            category = error_category(error)
            return _page(
                _form(hint, guess_code or "")
                + f'<p class="error">判定できませんでした（{html.escape(category)}）。'
                "AI_GATEWAY_API_KEY と Gateway のクレジットを確認してください。</p>"
            )
        return _page(_form(hint, guess_code or "") + _result(result))

    return app


app = create_app()
