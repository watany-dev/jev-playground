# jev-color — 255色でJevに文章を塗らせる

[Jev](https://vercel.com/ai-gateway/models/jev)（`typesafe-ai/jev`）の choice は候補を **255個** まで取れる。
その上限ぴったりの255色パレットを1リクエストで投げ、返ってきた255個の確率を
argmax だけでなく分布のまま見るサンプル（TypeScript / Bun / AI SDK）。

`jev-form` が47択で「分布の読み方」を見せるのに対し、こちらは上限まで候補を増やしたときに
分布がどう振る舞うかを主題にする。設計の意図は [docs/DESIGN.md](docs/DESIGN.md)。

## 1. 何が出るか

文章を1つ入れると、次が一度に返る。

| 表示 | 中身 |
| --- | --- |
| 最有力の1色 | choice の `choice` と、その確率 |
| 255色を確率で混ぜた色 | 255色を確率で加重混合した「期待色」。分布が割れるほど灰へ寄る |
| 255個の確率の格子 | 1セル=1色。確率が高い色ほど明るく浮かぶ（白枠が最有力） |
| 上位12色 | 分布の上位と、その確率 |
| 絞り込み量 | log2(255) − エントロピー。255択の上限は約 7.99 bit |
| 系統・明るさ・鮮やかさ・色の手がかり無し | 12択の choice、5段階の score 2つ、boolean |
| 自己整合 | Jev の明るさ・鮮やかさと、選んだ色の実測 HSL のずれ |

最有力の1色だけを見るなら255択である必要はない。このサンプルが見せたいのは、
**同じ1回の応答に入っている255個の確率を全部使うと何が言えるか**の方である。

## 2. 動かす

```bash
cd jev-color
bun install
read -rsp 'AI Gateway key: ' AI_GATEWAY_API_KEY && echo
export AI_GATEWAY_API_KEY
bun start               # http://127.0.0.1:8787
unset AI_GATEWAY_API_KEY
```

キーは環境変数からのみ読む。リポジトリ、`.env`、ログ、画面のいずれにも書かない。
Jev は有料クレジットのある Gateway アカウントでのみ実行できる（[../jev-auto/docs/REPORT.md](../jev-auto/docs/REPORT.md)）。

環境変数: `JEV_COLOR_HOST`（既定 `127.0.0.1`）、`JEV_COLOR_PORT`（既定 `8787`）。

1回あたり入力約4,200トークン（255色の criteria が大半）、Gateway 計上額はおよそ $0.0002。

### キー無しで画面だけ見る

```bash
bun run demo            # http://127.0.0.1:8788、Gatewayへ接続しない
```

固定の分布を返すスタブ。画面の手直しはこちらで足りる。

## 3. テスト

```bash
bun test
bun run check           # typecheck + test
```

Gateway へは接続しない。パレットが255色ちょうどであること、分布の畳み方
（期待色・エントロピー・上位）、壊れた応答を捨てること、入力長と同時実行数を
課金前に止めること、失敗が固定カテゴリしか漏らさないことを固定する。

## 4. 構成

| ファイル | 役割 |
| --- | --- |
| `src/palette.ts` | 255色（名前・hex・連想語・系統）。choice の criteria になる |
| `src/color.ts` | 混色・HSL・エントロピー。255個の確率を1色や1数へ畳む |
| `src/questions.ts` | 1リクエストに入れる5問と共有状態 |
| `src/evaluate.ts` | `experimental_evaluate` 呼び出しと、応答の畳み込み |
| `src/server.ts` | `GET /` と `POST /api/read` だけのサーバー |
| `src/ui.ts` | 1画面ぶんの HTML |
| `scripts/stub-server.ts` | Gateway へ繋がないデモ |

hex は「その色名として通る代表値」であって、JIS や伝統色の規格値ではない。
