# jev-rgb — JevにRGBを0〜255で決めさせる

[Jev](https://vercel.com/ai-gateway/models/jev)（`typesafe-ai/jev`）に、文章から連想される色を
**R・G・Bの3成分に分けて** 聞くサンプル（TypeScript / Bun / AI SDK）。

返ってくるのは1色ではない。成分ごとに16段階の確率が返り、その加重平均が 0〜255 の値になる。
画面はその途中経過をそのまま出す。設計の意図は [docs/DESIGN.md](docs/DESIGN.md)、
実装の解説は [blog/asking-jev-for-rgb.md](blog/asking-jev-for-rgb.md) を参照。

![読み取りの画面](blog/images/reading.png)

`jev-form`（47都道府県）が「候補の中から1つ選ぶ」分布を見せるのに対し、こちらは
**順序のある量**（成分の強さ）を Jev に出させ、その分布から連続値を組み立てる側を見る。

## 1. 何が出るか

文章を1つ入れると、次が一度に返る。

| 表示 | 中身 |
| --- | --- |
| 期待値の色 | 成分ごとの加重平均を並べた `rgb(r, g, b)`。画面の主役 |
| 光の強さで平均した色 | 同じ分布を線形sRGBで平均した色。分布が割れているほど明るい側へずれる |
| 最頻レベルの組み合わせ | 3成分とも最頻値を取った色と、独立と見なしたときのその確率 |
| 成分ごとの確率 | R・G・Bそれぞれ16段階のヒストグラム。▼ が加重平均 |
| 4096色の格子 | 3本の分布を掛けた 16³ 色。1タイル＝B固定、タイル内は横がG・縦がR |
| 上位12色 | 同上の積の上位 |
| 絞り込み量 | 成分ごと log2(16) − エントロピー。3成分合計の上限は 12 bit |
| 明るさ・無彩色 | 5段階の score と boolean |
| 自己整合 | Jev の明るさ・無彩色の自己申告と、組み上がった色の実測値のずれ |

## 2. なぜ choice ではなく score なのか

8bitのRGBは各成分が 0〜255 の **256段階** である。Jev の choice は候補を255個までしか取れないので、
256段階を choice で並べることはできない（1段階足りない）。

そもそも成分の強さには順序がある。順序のある量は score の側で、score は

- 段階数を自由に決められる（2段階以上の順序付きレベル）
- `probabilities` に各レベルの確率が入り、`score` はその加重平均である

という性質を持つ。本サンプルは16段階（刻み17、`15 * 17 = 255`）にして、
レベルの加重平均 × 17 がそのまま 0〜255 の期待値になるようにした。
16進で書けば `0x00, 0x11, ... 0xFF` である。

## 3. 動かす

```bash
cd jev-rgb
bun install
read -rsp 'AI Gateway key: ' AI_GATEWAY_API_KEY && echo
export AI_GATEWAY_API_KEY
bun start               # http://127.0.0.1:8787
unset AI_GATEWAY_API_KEY
```

キーは環境変数からのみ読む。リポジトリ、`.env`、ログ、画面のいずれにも書かない。
Jev は有料クレジットのある Gateway アカウントでのみ実行できる（[../jev-auto/docs/REPORT.md](../jev-auto/docs/REPORT.md)）。

環境変数: `JEV_RGB_HOST`（既定 `127.0.0.1`）、`JEV_RGB_PORT`（既定 `8787`）。

送信する質問のJSONは約5.0KB（UTF-8、実測5126バイト）。大半は3成分ぶんの16段階の説明である。

### キー無しで画面だけ見る

```bash
bun run demo            # http://127.0.0.1:8788、Gatewayへ接続しない
```

固定の分布を返すスタブ。画面の手直しはこちらで足りる。掲載している画像もこのスタブの出力で、
Jev の実際の応答ではない。

## 4. テスト

```bash
bun test
bun run check           # typecheck + test
```

Gateway へは接続しない。16段階が 0〜255 をちょうど覆うこと、分布の畳み方（8bitの平均と
光の平均、エントロピー、同時分布）、壊れた応答や `score` と分布が食い違う応答を捨てること、
入力長と同時実行数を課金前に止めること、失敗が固定カテゴリしか漏らさないことを固定する。

## 5. 構成

| ファイル | 役割 |
| --- | --- |
| `src/channels.ts` | 16段階と刻み17、R・G・Bの定義 |
| `src/color.ts` | 分布 → 0〜255、エントロピー、同時分布 |
| `src/questions.ts` | 1リクエストに入れる5問と共有状態 |
| `src/evaluate.ts` | `experimental_evaluate` 呼び出しと、応答の検証・畳み込み |
| `src/server.ts` | `GET /` と `POST /api/read` だけのサーバー |
| `src/ui.ts` | 1画面ぶんの HTML |
| `scripts/stub-server.ts` | Gateway へ繋がないデモ |

画面に出る4096色の格子は、Jev が返した同時分布ではない。成分ごとの確率を独立と見なして
掛けたものであり、成分間の相関は応答に含まれていない。
