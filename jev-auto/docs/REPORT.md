# Vercel AI Gateway 経由の Jev 接続検証レポート

検証日: 2026-09-17 (UTC)

## 結論

Vercel Pro への変更と AI Gateway Credits $10 の購入後、`typesafe-ai/jev` の実呼び出しに成功した。1回のリクエストで Boolean／Choice／Score の3種類すべてが型付きの確率とともに返り、HTTP 200、警告なしだった。

架空の二重請求チケットに対し、Jevは「返金済み」の確率を6%、担当を `billing`（100%）、緊急度を段階2「高」（100%）と評価した。入力内容および定義した判断基準と整合する結果だった。

## 事前調査

- Vercel での提供開始: 2026-09-16
- Vercel のモデルカタログ上のリリース日: 2026-09-15
- モデル ID: `typesafe-ai/jev`
- 対応 SDK: AI SDK 7.0.105 以降の `experimental_evaluate`
- 用途: 文章生成ではなく、共有状態に対する型付きの確率的判断
- 回答型: Boolean、Choice、Score
- 掲載価格: 入力 100 万トークンあたり $0.04、出力は課金表示なし
- Vercel 掲載のプロバイダー: TypeSafe AI のみ

参照:

- https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- https://vercel.com/ai-gateway/models/jev
- https://typesafe.ai/blog/introducing-system-one-models-and-jev

## 検証環境

- Node.js: 24.20.0
- npm: 11.19.0
- `ai`: 7.0.105
- SDK が使用した Gateway endpoint: `https://ai-gateway.vercel.sh/v4/ai/evaluation-model`
- 入力: 架空の日本語サポート問い合わせ
- 1リクエスト内の質問: Boolean、Choice、Score を各1件
- プロバイダー制限: `only: ['typesafe-ai']`

API キーはソース、`.env`、レポート、標準出力へ保存していない。

## 実行結果

### 4回目: Pro + AI Gateway Credits $10 購入後

- 結果: HTTP 200、警告なし
- クライアント観測の所要時間: 1,315.3 ms
- TypeSafe AI provider attempt: 386 ms
- 入力: 666 tokens
- 出力: 77 tokens
- 合計: 743 tokens
- Gateway計上額: $0.000027972
- プロバイダー: `typesafe-ai`（system credentials）
- model attempt: 1回、provider attempt: 1回

回答:

```json
{
  "refundAlreadyIssued": {
    "type": "boolean",
    "probability": 0.06
  },
  "destination": {
    "type": "choice",
    "choice": "billing",
    "probabilities": {
      "account": 0,
      "technicalSupport": 0,
      "billing": 1
    }
  },
  "urgency": {
    "type": "score",
    "score": 2,
    "probabilities": {
      "0": 0,
      "1": 0,
      "2": 1,
      "3": 0
    }
  }
}
```

`providerMetadata.typesafe.confidence` は `destination: 1`、`urgency: 1` だった。Booleanは回答自体がtrueの確率を直接返すため、このメタデータには含まれていない。

### 3回目: Vercel Pro 変更後の再試行（2026-09-17）

- 結果: HTTP 403（約1.2秒）
- エラー: `RestrictedModelsError` 相当
- Gateway のメッセージ: Free tier はこのモデルを利用できず、paid credits の購入が必要
- 結論: Vercel の Pro プラン契約と AI Gateway の paid credits tier は別管理。Pro への変更だけでは Jev の制限は解除されなかった

### 1回目: ZDR を明示

- 結果: HTTP 403
- エラー: `ZdrUnauthorizedError`
- 理由: Zero Data Retention は Pro / Enterprise 限定で、対象チームは Hobby プラン
- モデル推論: 未実行（provider attempt 0）

### 2回目: ZDR 指定を外す

- 結果: HTTP 403
- エラー: `RestrictedModelsError` (`no_providers_available`)
- 理由: Free tier は Jev を利用できず、有料クレジットが必要
- Gateway が解決したモデル: `typesafe-ai/jev`
- 解決したプロバイダー: `typesafe-ai`
- モデル推論: 未実行（provider attempt 0）

失敗した各試行でも Gateway から generation ID が返っており、API キー認証、Gateway 到達、モデル ID とプロバイダーの解決は成立していた。失敗点は TypeSafe AI への推論送信より前のプラン／クレジット検査だった。クレジット購入後は同一キー、同一コードで成功した。

## 再実行方法

検証時の環境は上記の Node.js / npm。現在の資材は `jev-auto/` に移し、Bunで実行する。

キーをファイルへ保存せずに再実行する例:

```bash
cd jev-auto
bun install --frozen-lockfile
read -rsp 'AI Gateway key: ' AI_GATEWAY_API_KEY && echo
export AI_GATEWAY_API_KEY
bun run test:jev
unset AI_GATEWAY_API_KEY
```

`answers` には次の3項目が出力される。

- `refundAlreadyIssued`: Boolean の true 確率
- `destination`: Choice と各候補の確率
- `urgency`: Score と各段階の確率

## 注意点

- Hobby / Free tier のままでは Jev の実出力は検証できない。
- ZDR を要求する場合は、有料クレジットだけでなく Pro / Enterprise プランも必要。
- Jev は早期提供段階かつ API は `experimental_` であるため、破壊的変更を想定して `ai` のバージョンを固定・検証するのが安全。
- 提供されたキーは会話に露出しているため、検証後に Vercel で失効・再発行することを推奨する。
- モデル提供者の利用規約にはベンチマーク公開に関する制限があるため、本検証は接続・機能確認として扱い、性能比較として公開しない。
