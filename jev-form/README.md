# jev-form — 47都道府県あてフォーム

ヒント文を [Jev](https://vercel.com/ai-gateway/models/jev)（`typesafe-ai/jev`）に渡し、
47都道府県の確率分布として「どこに近いか」を判定する Python (uv) のサンプルフォーム。

Jev は文章を生成せず、共有状態に対して型付きの確率だけを返す評価モデルである。
このサンプルは1リクエストで choice / score / boolean の3種類を同時に投げ、
返ってきた分布をそのまま画面へ出す。設計の意図は [docs/DESIGN.md](docs/DESIGN.md)、
実装の解説は [blog/guessing-prefectures-with-jev.md](blog/guessing-prefectures-with-jev.md) を参照。

## 1. 動かす

```bash
cd jev-form
uv sync
read -rsp 'AI Gateway key: ' AI_GATEWAY_API_KEY && echo
export AI_GATEWAY_API_KEY
uv run jev-form          # http://127.0.0.1:8000
unset AI_GATEWAY_API_KEY
```

キーは環境変数からのみ読む。リポジトリ、`.env`、ログ、画面のいずれにも書かない。
Jev は有料クレジットのある Gateway アカウントでのみ実行できる（[../jev-auto/docs/REPORT.md](../jev-auto/docs/REPORT.md)）。

環境変数: `JEV_FORM_HOST`（既定 `127.0.0.1`）、`JEV_FORM_PORT`（既定 `8000`）、`JEV_FORM_RELOAD`。

## 2. 使い方

1. ヒントを書く。例: `砂丘があって、梨が名産。人口は日本で一番少ない。`
2. 任意で自分の予想都道府県を選ぶ。
3. 送信すると、次が表示される。
   - Jev の最有力都道府県と、上位5件の確率
   - 地方（8区分）の最有力とその確率
   - ヒントの絞り込み度（0〜3のスコア）
   - 地理と無関係な入力である確率
   - 予想を選んだ場合の近さ判定: 正解 / 惜しい（同じ地方） / 可能性は残る / 遠い
   - 入出力トークンと Gateway 計上額

## 3. テスト

```bash
uv run pytest
```

Gateway へは接続しない。`httpx.MockTransport` で応答を差し替え、次を検証する。

- 送信するリクエストが AI SDK と同じ形か（URL、仕様バージョン4ヘッダ、`{state, questions, providerOptions}`）
- 壊れた応答（確率の和が1でない、最大確率でない選択、範囲外のスコア、欠けた回答）を拒否するか
- 入力が HTML エスケープされ、失敗時にキーやスタックを画面へ出さないか

## 4. 構成

| ファイル | 役割 |
| --- | --- |
| `src/jev_form/gateway.py` | Gateway `evaluation-model` への最小クライアントと応答検証 |
| `src/jev_form/prefectures.py` | 47都道府県と8地方のマスタ（choice の criteria になる） |
| `src/jev_form/quiz.py` | 質問セット、共有状態、結果の整形と近さ判定 |
| `src/jev_form/app.py` | FastAPI の1画面フォーム |

Python 版の AI SDK は無いため、`gateway.py` は `@ai-sdk/gateway@4.0.85` が送る形と
`ai@7.0.105` の応答検証規則を移植している。
