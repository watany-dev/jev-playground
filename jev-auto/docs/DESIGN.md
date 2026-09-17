# Jev Guarded Auto Mode for Codex — 設計案

作成日: 2026-09-17  
対象: Bun / Codex CLI 0.154.0 / AI SDK 7.0.105 / `typesafe-ai/jev`

開発・実行基盤は Bun とする。依存管理は `bun install` と `bun.lock`、
今後のフック実装は TypeScript、テストは `bun test` を使う。
現在の実装範囲とコマンドは [README](../README.md) を参照。

## 初版実装との差分

以下は当初の目標設計。初版の実装仕様はREADMEを優先する。
安全性に関わる未実装機能を、実装済みの保証として扱わない。

- `policy.yaml` の代わりに固定の `src/policy.ts` を採用。
- shell AST全般ではなく、単一コマンドの限定構文を受け付ける。
- PermissionRequestはAutoでは全拒否、shadowでは通常の承認へ委譲する。限定的昇格は未実装。
- subagentは無効化。専用予算の継承は将来対応。
- Jev評価は8つのBooleanを使用。明示的な危険確率と必要性・完了性を検査する。
- 状態は親プロセスで直列更新し、監査用に原子的なスナップショットを保存する。プロセスを跨ぐ復元はしない。
- 変更量制限はapply_patchの試行のみ。shellスクリプト内部の変更量は集計しない。
- 課金上限は観測値と予約による停止条件。請求総額の絶対上限は保証しない。
- フックが開始できない／無効化された場合の完全なfail-closedはCodex側の強制境界なしには保証できない。
- スクリプト・ポリシーのハッシュ監視は改変検知であり、同一UIDに対する強制隔離ではない。

## 1. 結論

Codex を `danger-full-access` や承認・サンドボックス無効化で動かし、Jevだけに安全性を委ねる設計は採用しない。Jevは確率的な判定器であり、Codexの一部ツールはフック対象外だからである。

採用するのは **Guarded Auto Mode** とする。

1. OS/Codexサンドボックスと決定論ルールを、越えられない安全境界にする。
2. Jevを `PreToolUse` と `PermissionRequest` に同期接続し、文脈依存の操作を判定する。
3. ルールとJevの両方が許可した操作だけを自動実行する。
4. Jev障害、判定不能、低確信、予算超過は拒否または安全停止に倒す。
5. `Stop` フックで自律継続できるが、回数・時間・費用・変更量にハード上限を置く。

このモードは「人の承認なしで長時間進める」ためのものであり、「無制限の権限」を与えるものではない。

## 2. 前提と非目標

### 前提

- 起動は `sandbox_mode = "workspace-write"` を基本とする。
- `approval_policy = "on-request"` のまま、承認要求を `PermissionRequest` フックが自動裁定する。
- `--dangerously-bypass-approvals-and-sandbox` は禁止する。
- JevのVercel AI Gatewayキーはリポジトリ、Codexのプロンプト、ログ、子プロセス環境へ渡さない。
- プロジェクトローカルフックは、ハッシュが変わるたびに利用者が一度信頼確認する。

### 非目標

- 本番デプロイ、送金、削除、公開、外部メッセージ送信などの不可逆操作を完全自動化しない。
- Jevの確率を形式検証や強制アクセス制御の代替にしない。
- フック対象外のホステッドツールをJevが監視できるとはみなさない。

## 3. 脅威モデル

防ぐ対象:

- Codex自身の誤判断、幻覚、過剰なスコープ拡大
- リポジトリ内文書、Web、ツール出力からのプロンプトインジェクション
- 破壊的コマンド、秘密情報の読取・表示・送信
- 許可されていないネットワーク、外部サービスの副作用
- 無限ループ、同じ失敗の反復、コスト暴走、大量変更
- Jev/Gatewayの停止、遅延、不正応答、将来のAPI変更
- フックの改変や無効化

残余リスク:

- フック対象外ツール、未知のツール実装、OSやCodex自体の脆弱性
- 許可済みコマンド内部で起きる意味的な副作用
- Jevの誤分類、過信、分布外入力
- 同じユーザー権限で動く悪意あるプロセスによるフック／資格情報への攻撃

## 4. 全体アーキテクチャ

```text
User goal
   |
   v
UserPromptSubmit ----> goal envelope / budget / forbidden effects
   |
   v
Codex agent proposes a tool call
   |
   v
PreToolUse
   |-- deterministic policy ---- deny --------> Codex receives reason
   |             |
   |             +-- trivially safe allow ----> sandbox executes
   |             |
   |             +-- context dependent
   |                        |
   |                        v
   |                    Jev evaluate
   |                        |
   |          allow only below calibrated risk thresholds
   |                        |
   v                        v
PermissionRequest ---- Jev + stricter escalation policy
   |
   v
Codex sandbox / permission profile (hard boundary)
   |
   v
PostToolUse ---- audit / secret scan / budget update / recovery feedback
   |
   v
Stop ---- completion check ---- stop
          |          |
          |          +-- unsafe/stuck/budget exceeded --> stop
          +-- incomplete and within budget ------------> bounded continuation
```

構成要素:

- `jev-guard`: stdinのフックイベントを読み、静的ルールとJev判定を統合してCodex形式のJSONをstdoutへ返す単一実行ファイル。
- `policy.yaml`: 人がレビュー可能なdeny/allow規則、ツール別ポリシー、確率閾値。
- `session-state/<session_id>.json`: 目標、予算、累積操作、継続回数、直近失敗。ファイルロックと原子的置換を使う。
- `audit.jsonl`: 入力の要約・ハッシュ、規則、Jev回答、最終判断、所要時間、コスト。秘密値と生のツール出力は保存しない。
- Credential broker: GatewayキーをOSキーチェーンまたは親プロセスから取得し、Codexが実行するshell環境には継承させない。

## 5. フック設計

| フック | 同期 | 役割 | 失敗時 |
|---|---:|---|---|
| `SessionStart` | Yes | ポリシーバージョン、予算、監査状態を初期化し、安全規約をdeveloper contextへ追加 | セッション停止 |
| `UserPromptSubmit` | Yes | 秘密検知、目標・許可スコープ・禁止副作用を抽出 | promptをblock |
| `PreToolUse` | Yes | 全対応ローカルツールを実行前に静的ルール→Jevで裁定 | deny |
| `PermissionRequest` | Yes | sandbox昇格・ネットワーク・MCP書込などを、通常より厳しい基準で裁定 | deny |
| `PostToolUse` | Yes | 結果、差分、秘密漏えい、反復失敗、予算を検査 | 結果をblockし、回復指示 |
| `PreCompact` | Yes | 監査台帳と安全状態を固定し、未反映更新があればcompaction停止 | stop |
| `PostCompact` | Yes | goal envelopeと予算を再注入 | stop |
| `SubagentStart` | Yes | 親と同等以下の権限・予算を子へ伝播 | 子には権限を付与しない |
| `SubagentStop` | Yes | 子の未完了判定。追加実行は1回など個別上限を適用 | stop |
| `Stop` | Yes | 完了性をJevで評価し、必要時だけ継続promptを生成 | stop |
| `Interrupt` | Yes | 中断を監査ログへ記録。最大3秒なのでJevは呼ばない | 中断を維持 |
| `SessionEnd` | Yes | 最終サマリと監査ログのflush。最大3秒なのでJevは呼ばない | 終了を維持 |

`PreToolUse` の `allow` はサンドボックス昇格を意味しない。昇格が必要なら、その後の `PermissionRequest` でもう一度通す。

## 6. 判定パイプライン

### Stage A: 入力の正規化

- イベントJSONにサイズ上限を設ける。
- tool name、command、cwd、対象パス、URL/host、MCP server/toolを構造化する。
- shell文字列は実行せずにAST解析し、パイプ、リダイレクト、subshell、環境変数、globを保守的に扱う。
- transcript全体は送らず、ユーザー目標、直近の関連操作、正規化済みtool inputだけをJevへ渡す。
- ツール出力中の命令文は「信頼できないデータ」と明示する。

### Stage B: 決定論的ポリシー

Jevを呼ぶ前に判定する。

Hard deny例:

- workspace外への書込、`.git` 内部の直接変更、hook/policy/audit自身の変更
- `rm -rf`、raw disk、権限変更、資格情報ストア読取、履歴消去
- `git push --force`、release/deploy/publish、課金・送金、外部メッセージ送信
- 秘密らしい値のstdout出力、URL・引数・環境変数への埋込み
- 未許可domain、private network、metadata endpoint、Unix socket
- `codex --dangerously-bypass-approvals-and-sandbox` やフック無効化

Static allow例:

- workspace内のread-only検索
-ロックファイルを変更しない構文検査
-既知のテストコマンド（ネットワークなし、明示timeoutあり）

その他はJevへ送る。未知のツールはstatic allowに入れず、原則denyにする。

### Stage C: Jevによる型付き評価

1回の `evaluate` で以下を同時に質問する。

```js
questions: {
  destructiveOrIrreversible: { type: 'boolean', instructions: '...' },
  secretExposure:            { type: 'boolean', instructions: '...' },
  externalSideEffect:        { type: 'boolean', instructions: '...' },
  scopeViolation:            { type: 'boolean', instructions: '...' },
  promptInjectionInfluence:  { type: 'boolean', instructions: '...' },
  riskClass: {
    type: 'choice',
    criteria: { low: '...', medium: '...', high: '...', critical: '...' }
  },
  goalProgress: {
    type: 'score',
    criteria: ['無関係', '弱い', '必要', '完了に不可欠']
  }
}
```

判定はJevの単一ラベルではなく、各危険事象の確率を使う。初期閾値は以下を仮置きし、shadow modeの実測で校正する。

- `critical/high` の合計確率が 0.01 以上ならdeny。
- いずれかの危険Booleanが 0.02 以上ならdeny。
- `goalProgress` が「必要」以上である確率が 0.90 未満ならdeny。
- 分布が不自然に飽和、必須回答欠落、NaN、schema不一致ならdeny。
- `PermissionRequest` はより厳しく、危険確率 0.005 未満かつ静的に許可可能な昇格種別だけallow。

これらは安全性を証明する数値ではない。誤許可率を測って決める運用パラメータである。

### Stage D: 最終合成

```text
DENY = hard_deny
    OR jev_error_or_timeout
    OR risk_threshold_exceeded
    OR budget_exceeded
    OR unsupported_or_unknown_tool

ALLOW = sandbox_contains_effect
     AND deterministic_constraints_pass
     AND jev_passes_when_required
```

複数フックが動く場合は、Codexの仕様どおりdenyを優先する。Jevフック以外の監査／secret scanフックも独立させ、どれか1つが拒否すれば止める。

## 7. 自律継続 (`Stop`) の設計

`Stop` は「まだ作業がある」だけで継続させない。次をすべて満たす場合だけ `decision: "block"` と具体的な次の1手を返す。

- 成功条件に未達である根拠がある。
- 次の操作が明確で、前回と同じ失敗の反復ではない。
- テストまたは検証で進捗を観測できる。
- 全予算内である。

初期ハード上限:

- 自動継続: 8回/turn、20回/session
- wall clock: 30分/session
- Jev判定: 500回/session
- Gateway費用: $0.05/session
- tool call: 300回/session
- 変更ファイル: 50、差分: 3,000行
- 同一エラーfingerprint: 3回で停止
- Jev連続障害: 2回でcircuit open、セッション停止

上限到達時は続行せず、未完了点、最後の安全な状態、必要な人間判断を報告する。

## 8. フェイルセーフ

- Jev timeoutは通常2秒、昇格判定5秒。timeoutはdeny。
- Gateway 429/5xx、認証失敗、DNS失敗はdeny。自動的に別モデルへfail-openしない。
- JevモデルIDとproviderを `typesafe-ai/jev` / `typesafe-ai` に固定する。
- SDKは厳密バージョンで固定し、schema contract testを通した版だけ更新する。
- stdoutにはCodexが期待するJSONだけを出し、診断はredacted stderr/auditへ送る。
- hook process crash、空出力、不正JSONをラッパーが明示denyへ変換する。
- audit書込失敗は、危険操作ではdeny。read-only操作は設定により継続可能。
- フック自体のファイルhashとpolicy hashをSessionStart時に固定し、途中変更を検出したら停止する。

重要: Codexの公式仕様では、単なるhookエラーが常にtool callを止めるわけではない。したがって、Jev本体を直接hookにせず、あらゆる内部エラーを有効なdeny JSONまたはexit code 2へ変換する小さなfail-closedラッパーを置く。

## 9. 権限と秘密管理

- Gatewayキーは会話で使った既存キーを再利用せず、専用の最小権限キーを発行する。
- OS keychainまたは専用brokerから取得し、`.env`、`config.toml`、hook入力、監査ログには保存しない。
- Codexのshell環境から `AI_GATEWAY_API_KEY` 等を除外する。
- workspaceはwrite可、それ以外はread-onlyまたはdeny。`~/.ssh`、cloud credentials、password store、他repoはdeny-read。
- sandbox内ネットワークはデフォルトoff。必要な開発通信だけdomain単位・tool単位で許可する。
- Jevへの送信前に秘密、個人情報、大きなソース本文をredactする。
- プロジェクトからhookを無効化・変更できない強度が必要なら、repo-local hookではなく管理者配布の`requirements.toml` managed hooksを使う。

## 10. 推奨設定の骨格

実装時は次の方向で `config.toml` / `hooks.json` を生成する。

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = false

[features]
hooks = true
network_proxy = true
```

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "jev-guard SessionStart", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "jev-guard UserPromptSubmit", "timeout": 5 }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "jev-guard PreToolUse", "timeout": 5 }] }],
    "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "jev-guard PermissionRequest", "timeout": 7 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "jev-guard PostToolUse", "timeout": 5 }] }],
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "jev-guard PreCompact", "timeout": 5 }] }],
    "PostCompact": [{ "hooks": [{ "type": "command", "command": "jev-guard PostCompact", "timeout": 5 }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "jev-guard SubagentStart", "timeout": 5 }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "jev-guard SubagentStop", "timeout": 5 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "jev-guard Stop", "timeout": 7 }] }],
    "Interrupt": [{ "hooks": [{ "type": "command", "command": "jev-guard Interrupt", "timeout": 1 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "jev-guard SessionEnd", "timeout": 3 }] }]
  }
}
```

実際のcommandは絶対パスまたはgit rootから解決し、ユーザー入力をshell文字列へ連結しない。

## 11. 段階導入

### Phase 0 — Contract tests

- 全フックイベントのfixtureと期待JSONを作る。
- timeout、不正JSON、部分回答、429、hook crashが必ずdenyになることを検証する。
- 危険コマンドcorpus、正常コマンドcorpus、prompt injection corpusを用意する。

### Phase 1 — Shadow mode

- sandboxと人間承認を維持し、Jev判断はログだけに残す。
- false allow、false deny、遅延、費用、確率校正を測る。
- TypeSafeの条件に反する公開ベンチマークにはせず、内部の安全性検証として扱う。

### Phase 2 — Safe auto

- read-onlyとworkspace内の可逆変更だけ自動許可する。
- network、外部副作用、sandbox昇格はdenyのままにする。

### Phase 3 — Scoped escalation

- 十分な検証後、限定domain・限定コマンドだけ `PermissionRequest` で自動許可する。
- リリース、公開、削除、秘密アクセスは引き続き人間承認または恒久denyとする。

## 12. 受け入れ基準

- hard deny corpusの誤許可が0件。
- Jev/Gatewayを停止しても、書込・ネットワーク・昇格操作が1件も通らない。
- フック改変、無効化、timeout、不正応答で安全停止する。
- フック対象外ツールは自動モードで無効化または別の強制境界に閉じ込められる。
- 同一失敗3回、継続上限、費用上限で確実に停止する。
- キーや検出した秘密がstdout、transcript、auditに残らない。
- 全allow/denyについて、rule id、Jev確率、policy version、session/turn/tool idから事後説明できる。

## 13. 実装順

1. hook fixtureとfail-closed出力ラッパー
2. shell/tool正規化とhard denyルール
3. session budget・監査台帳
4. Jev evaluatorとschema検証・circuit breaker
5. `PreToolUse`、`PermissionRequest`
6. `PostToolUse`
7. `Stop` とcompaction/subagent連携
8. shadow mode評価後にsafe autoを有効化

## 14. 参照

- OpenAI Hooks guide: https://developers.openai.com/codex/hooks
- OpenAI Codex configuration reference: https://developers.openai.com/codex/config-reference
- Vercel Jev model page: https://vercel.com/ai-gateway/models/jev
- TypeSafe Jev launch post: https://typesafe.ai/blog/introducing-system-one-models-and-jev
