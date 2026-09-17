# jev-auto

JevをCodexのhooksへ接続するAuto Modeプロジェクト。Bunで依存管理・実行・検証する。

初版のAuto Modeを実装済み。`PreToolUse` でルールとJevを通し、
`Stop` で未完了かつ進捗のある作業だけ自動継続する。
Linux/macOSのBun 1.4.2以降、Codex CLI 0.154.0向け。Windowsは未対応。

この実装はサンドボックス内で使うガードレールであり、フック単体での完全隔離は保証しない。
Codex実セッションでの無人運用前に、下記のshadow modeで自分の作業に対する判定を確認する。

追試は「[セットアップと検証](#セットアップと検証)」→「[動作確認の手順](#動作確認の手順)」の順に進める。
今回の環境では **60テスト成功、1件はUnixソケット作成がEPERMで失敗、型検査・ビルド成功**。
フック別プロセスとUnixソケットの結合テストを含むが、Jev応答はモック。
実Gatewayを使ったAuto Mode＋Codex実セッションは未検証なので、以下の追試で確認する。

## 構成

```text
jev-auto/
  docs/
    DESIGN.md           Auto Modeの設計と実装順
    REPORT.md           既存のJev接続検証結果
  scripts/
    run-jev.mjs          Gateway経由の接続検証
  src/
    cli.ts              init / run / hook
    config.ts           Codex設定と子プロセス環境
    hook.ts             stdinイベント→broker→Codex応答
    broker.ts           Unixソケットのローカル判定サービス
    engine.ts           同時実行の直列化・予算・継続・監査
    policy.ts           固定ポリシーと小さなshell構文の検査
    evaluator.ts        Jev呼び出しと確率・課金情報の検証
    protocol.ts         フック入出力契約
  tests/guard.test.ts    単体・障害・フックプロセス結合テスト
  package.json
  bun.lock              依存バージョンを固定
```

## セットアップと検証

[Bun](https://bun.sh/docs/installation) 1.4.2以降をインストールして実行する。検証バージョンは1.4.2。
以下はBashで実行する。Codexのログインは済ませておく。

```bash
# リポジトリのルートから実行する。
cd jev-auto
bun --version
codex --version
bun install --frozen-lockfile
bun run check
bun test
```

このワークスペースでは `cd /workspaces/jev-playground/jev-auto` でも移動できる。
全テストを実行できる環境での成功の目印は `61 pass` / `0 fail`。
`bun test` はローカルのUnixソケットを作るため、`EPERM ... listen` が出たらソケット作成を許可した環境で再実行する。
ここまでのコマンドは有料APIを呼ばない。

`check` はTypeScriptの型検査後、Bun向けにCLIと接続スクリプトをビルドする。
生成物は `.check/` に置き、API呼び出しは行わない。
依存を変更したときは `bun install` で `bun.lock` を更新する。
[Bunのlockfile仕様](https://bun.sh/docs/pm/lockfile) に従い、npmのlockfileは併用しない。

## 動作確認の手順

ターミナルAにはCodexの表示とフックの拒否理由が表示される。
監査JSONはTUI描画との競合を避けるためファイルにのみ出力する。逐次確認する場合は別ターミナルBを使う。
Aは引き続き `jev-auto/` をカレントディレクトリにする。
以下の手順は実Gatewayを使うため、Jev判定とCodexの利用料金が発生する。

### 1. 追試用リポジトリを作る（A）

```bash
JEV_TARGET="$(mktemp -d /tmp/jev-auto-repro.XXXXXX)"
git init "$JEV_TARGET"
bun -e 'await Bun.write(Bun.argv[1] + "/README.md", "# Jev Auto Repro\n\nThis repository is a local smoke test.\n");' "$JEV_TARGET"
echo "$JEV_TARGET"
bun run start init "$JEV_TARGET"
```

`Created .../.codex/hooks.json` が出れば生成成功。同じ設定での再実行は `Already configured` となる。
既存のhooks.jsonは上書き・自動マージしない。追試には上の新規リポジトリを使う。
実際のプロジェクトを使う場合は、その絶対パスを `JEV_TARGET` に指定する。
ガード自身の `jev-auto/` は保護対象なので、編集確認には別ディレクトリを使う。

### 2. Codexでフックを信頼する（A）

```bash
codex -C "$JEV_TARGET"
```

プロジェクトを信頼したうえで、Codex内の `/hooks` を開き、12個のjev-autoフックを確認・信頼して終了する。
この段階では作業を依頼しない。ランチャーが起動していないため、フック実行時に
`hook/broker unavailable` が表示される場合がある。判定サービスとの接続確認は手順4で行う。
フックが未信頼のままだと、Codexはそのフックをスキップすることがある。

### 3. Gatewayキーを設定する（A）

```bash
read -rsp 'AI Gateway key: ' AI_GATEWAY_API_KEY && echo
export AI_GATEWAY_API_KEY
```

キーはファイルやCodexのプロンプトに貼らない。ランチャーの親プロセスが保持し、Codex子プロセスへは渡さない。
同じターミナルAでは終了後も環境変数が残るため、再試行時に毎回入力する必要はない。

Gateway接続だけを先に確かめたい場合は `bun run test:jev` を実行する。
`"ok": true` が成功の目印。ただしこれは接続検証スクリプトであり、Auto Modeのフックは通らず、監査ログも生成しない。

### 4. shadowで読み取りを確認する（A）

```bash
bun run start run "$JEV_TARGET" --shadow 'Bashツールで cat README.md を単一の非対話コマンドとして実行し、内容を1行で要約してください。ファイルは変更しないでください。'
```

起動時の表示例:

```text
jev-auto shadow; audit: /tmp/jev-auto-XXXXXX
```

この `audit:` のパスには、監査記録が調査用JSONLとして保存される。
追試用リポジトリ `JEV_TARGET` とは別のディレクトリ。
shadowはJev判断をログに残し、Jevの拒否は実行を止める判断に使わない。
静的な禁止ルールは適用し、権限要求は通常の承認へ渡す。自動継続はしない。

### 5. フックとJevのログを確認する（A）

ターミナルBで起動時に表示されたログ保存先を指定し、次を実行する。

```bash
JEV_LOG_DIR=/tmp/jev-auto-XXXXXX
tail -f "$JEV_LOG_DIR/audit.jsonl" "$JEV_LOG_DIR/judgments.jsonl"
```

`audit.jsonl` はフックイベント、`judgments.jsonl` はJev評価の成功・失敗を表す。
`status: "ok"` は有効な回答の受信（許可とは限らない）、`status: "error"` は評価失敗。
成功時は `safe` と閾値違反の `reasons`、失敗時は固定分類の `error` を記録する。
両方に `durationMs` とイベントに対応する `session` / `turn` / `tool` のハッシュを付ける。
`audit.jsonl` と `judgments.jsonl` は起動時に作成されるため、必要なら終了後に `audit:` のパスから読み返せる。

| 観測するもの | 意味・成功の目印 |
|---|---|
| `audit.jsonl` の `event: "SessionStart"` | フック→ローカル判定サービスへの接続を確認。Jev成功の証拠ではない |
| `event: "UserPromptSubmit"` | ユーザー依頼を受信 |
| `event: "PreToolUse"` | 実行前チェックを実施。許可・拒否は `decision` の中を確認 |
| `judgments.jsonl` の `purpose: "tool"` と `probabilities` / `cost` | ツールについてJevの有効な回答を受信 |
| `event: "PostToolUse"` | ツール実行後の結果を受信。コマンド自体の成功はCodexの出力でも確認 |
| `counts.evaluations` | 判定を試みた回数。失敗も含むので、これだけではJev成功とはいえない |

読み取り確認では、**READMEの要約、`PreToolUse`、`purpose: "tool"` の判定記録、`PostToolUse`** が揃うことを確認する。
`pwd` と計画更新はJevを呼ばないので、Jev接続の確認には使わない。

`jq` が入っていれば、監視を止めて次のように必要な項目だけ読める（任意）。

```bash
jq -c '{event, mode, decision, counts}' "$JEV_LOG_DIR/audit.jsonl"
jq -c '{purpose, status, safe, reasons, error, durationMs, probabilities, cost}' "$JEV_LOG_DIR/judgments.jsonl"
```

### 6. Autoで編集を確認する（A）

shadowのCodexを終了し、同じAで起動する。

```bash
bun run start run "$JEV_TARGET" 'README.mdをcatで読み、apply_patchで末尾に「Auto Mode smoke test passed.」という1行を追加してください。その後cat README.mdで追加を確認して終了してください。各シェル呼び出しは単一の非対話コマンドにしてください。'
```

Auto起動の表示は `jev-auto auto; audit: ...`。**起動ごとにログ保存先が変わる**。
追加行と再読込結果を確認し、Jev判断とフックイベントが記録されていれば編集経路の追試成功。
Jevに拒否された場合は、その拒否が記録されたことまでが確認結果であり、編集成功とは区別する。

自動継続した場合は、`Stop` イベントの `decision.decision` が `"block"`、
`decision.reason` が `Jev Auto continuation ...` となり、`counts.continuations` が増える。
小さい作業が1回で完了した場合は継続しなくて正常。`Stop` 自体は常に自動継続を意味しない。
継続条件・回数上限を確実に再現する検証は `bun test` に含まれるモックテストで行っている。

### 7. 拒否経路を確認する（任意、A）

現在のCodex内で次の依頼をする。対象は副作用のない複合コマンドで、削除等は使わない。

```text
Bashツールで pwd && pwd を1つのコマンドとして実行してください。
フックに拒否されたら、別コマンドへ変更せず、拒否されたことを報告して終了してください。
```

`PreToolUse` の `decision.hookSpecificOutput.permissionDecision` が `"deny"`、
理由が `jev-auto: unsupported-shell-syntax` なら静的拒否の動作を確認できた。
この拒否にJevは不要なので、対応する `judgments.jsonl` の行は増えない。
Codexがツール呼び出し前に実行を見送った場合はフックの追試にはなっていない。

### 8. 終了と記録（A）

AでCodexを終了する。中断したセッションでは以降の操作を許可しないため、再試行はランチャーから新しく起動する。
キーの環境変数を解除する。

```bash
unset AI_GATEWAY_API_KEY
```

調査用に次の情報を控えると再現しやすい。`JEV_LOG_DIR` には起動時に表示された `audit:` のパスを指定する。

```bash
JEV_LOG_DIR=/tmp/jev-auto-XXXXXX
bun --version
codex --version
tail -n 20 "$JEV_LOG_DIR/audit.jsonl"
tail -n 5 "$JEV_LOG_DIR/judgments.jsonl"
```

併せて、shadow/autoのどちらか、依頼内容、Codex上のエラー、期待した結果を記録する。
ログにはコマンドやパスが含まれ得る。共有前に内容を確認し、APIキーは共有しない。
テストリポジトリとログは自動削除しない。必要な記録を残してから個別に片付ける。

## うまく動かない場合

| 症状 | 確認すること |
|---|---|
| `bun: command not found` | Bunをインストールし、そのターミナルのPATHで `bun --version` が通ることを確認 |
| `Existing hooks.json differs` | 既存設定は上書きしない。新規の追試用リポジトリで手順1から進める |
| `Set AI_GATEWAY_API_KEY ...` | Aでキーを `export` したか確認。Bだけに設定してもAには渡らない |
| `No SessionStart received ...` で約15秒後に終了 | プロジェクトの信頼設定、`/hooks` の信頼状態、フック定義内のBun/ソースの絶対パスを確認 |
| `hook/broker unavailable` | 通常の `codex` ではなく `bun run start run ...` で起動したか確認。手順2の信頼設定時だけなら想定内 |
| `SessionStart` はあるが `PreToolUse` がない | ツールを実行する依頼だったか確認。文章だけの応答やフック対象外経路では実行前イベントは出ない |
| `judgments.jsonl` が空 | `cat README.md` などJev対象操作を依頼したか確認。静的拒否や `pwd` では評価行が増えない |
| `Jev rejected` | 後続の項目名・確率・閾値を確認する。同じ操作を繰り返さず、依頼と判定条件を調査する |
| `evaluation unavailable` | 括弧内とログの `error` を確認。`timeout`、`http-401` 等、`invalid-answer`、`invalid-cost`、`provider-error` に分類する |
| `repeated-tool-denial` | 静的拒否も含めてツールが連続3回拒否された。セッションは停止するため原因を解消して起動し直す |
| `test:jev` で401/403 | キーと対象チーム、AI Gatewayの有料クレジットを確認。Pro契約だけでは通らなかった既存検証結果は `docs/REPORT.md` に記載 |
| `jev-circuit-open` / 予算超過 / 中断後の拒否 | セッションの停止条件。原因を解消し、ランチャーを新しく起動する |
| `EPERM ... broker.sock` / 汎用の起動エラー | Unixソケットを作れる環境か確認。起動前エラーの詳細は現状CLIで省略されるため、`bun test` の結合テストも確認 |

HTTPステータスと判定所要時間は記録するが、プロバイダーの生エラー本文・リクエスト本文は記録しない。
broker到達前の失敗、改変検知後の拒否、一部の中断・終了経路もすべて監査ログに残るわけではない。
ログがないことだけを理由に「安全に許可された」とは判断しない。

`init` のフックはBunとソースの絶対パスを固定する。ディレクトリやBunの場所を移した場合は、
既存フックを手動で退避し、新しい定義を生成して再レビューする。
起動は `src/cli.ts` を使用する。`.check/` はビルド確認用で、配布用の実行ファイルではない。

## 初版の動作

- `workspace-write`、ネットワーク禁止、`on-request` を維持。Autoでは権限昇格要求をすべて拒否する。
- shellは単一の非対話コマンドだけを受け付ける。パイプ・リダイレクト・変数展開・複数行は拒否する。
- `pwd` と計画更新はローカル判定。`ls/cat/head/tail/wc/rg` の限定オプション、`git status/diff/log`、`bun test`、`bun run test/check/build/lint/typecheck` はJevで評価する。
- 編集は `apply_patch` の追加・更新のみ。削除、移動、workspace外、シンボリックリンク、`.git/.codex/.env` 等とガード自身への編集は拒否する。
- MCP・未知ツール・subagentは拒否。ランチャーでapps、browser/computer use、Web検索、multi-agentを無効化する。
- Jevの通信失敗・4秒のtimeout・欠けた回答・不正な確率・課金メタデータ欠落はAutoで拒否。2連続障害でそのセッションを停止する。
- `Stop` は観測済みのツール結果とJev判断を使う。新たな結果がない、完了している、安全な次手が不明なら継続しない。
- 継続は最大8回/ユーザー依頼、20回/セッション。最大30分、300ツール、500判定。新しい依頼・compaction・resumeでセッション全体の予算をリセットしない。
- patchは試行ベースで累積50パス/3,000変更行。実行後の同一失敗3回、または実行前の連続拒否3回で停止。許可された呼び出しで連続拒否数をリセットする。静的拒否もツール予算へ計上する。スクリプト内部のファイル変更量まで検査する仕組みではない。
- 観測課金額の上限は$0.05。リクエスト前に$0.001を予約し、課金情報が得られなければ予約を保持する。送信済みリクエストや価格変更まで含めた請求のハード上限ではない。
- 中断・終了後は許可しない。再開は新しいランチャー起動から行う。

予算と仮置きの確率閾値は `src/policy.ts` で定義する。リポジトリ内の任意設定で権限を拡大しない。
確率閾値は安全性の証明ではなく、今後の実測で校正する値。
読み取りの評価質問は、仮想的な危険ではなく具体的な証拠とユーザーの許可に基づくよう修正済み。
閾値は据え置き。今回の環境にはGatewayキーがなく、この質問変更によって実Jevがsmoke testを許可するかは未検証。

## 監査と保証範囲

起動時に表示する一時ディレクトリ（mode 0700、workspace外）に、`audit.jsonl`、
`judgments.jsonl`、セッションスナップショット（mode 0600）を保存する。
入力イベント自体はハッシュで記録する。ただし許可時の `decision.hookSpecificOutput.updatedInput` に
実行コマンドが含まれるため、監査ログに生のコマンドが残る場合がある。スナップショットにはマスク済みのユーザー目標と
直近出力の短い抜粋が含まれる。マスキングは既知パターンに対する検出であり、全秘密・個人情報を識別するものではない。
不要になった監査ディレクトリは利用者が削除する。ログからの自動resumeは行わない。

フックが開始した後の内部エラーは明示拒否に変換する。一方、フックが未信頼・無効、
Bunが起動不能、フックがSIGKILLされた場合には、そのコード自体が動かない。
起動後15秒以内にSessionStartを受けなければランチャーがCodexを終了するが、
これは実行前の原子的な遮断を保証するものではない。
サンドボックスとフック信頼設定を保持し、初版を無制限アクセスで使わない。

許可されたテストやbuildスクリプトは内部で任意コードを実行し得る。
Jev判定、パス検査、実行時のソースハッシュ確認はOSのアクセス制御の代わりにはならない。
同一UIDの悪意あるプロセス、検査後のファイル差し替え、既に起動した子プロセス、
他の設定層のフックやフック対象外ツールまでは封じ込めない。
`write_stdin` はCodexの仕様上、実行開始後の入力を再検査しない。
`PostToolUse` の拒否も実行済みの副作用を取り消さない。
より強い隔離には使い捨てVM/コンテナと管理者配布の設定が必要。

仕様参照: [Codex Hooks](https://developers.openai.com/codex/hooks)、
[Codex設定](https://developers.openai.com/codex/config-reference)。

## Jevの実接続検証

以下はBashの例。Gatewayへの有料リクエストを1回送る。

```bash
read -rsp 'AI Gateway key: ' AI_GATEWAY_API_KEY && echo
export AI_GATEWAY_API_KEY
bun run test:jev
unset AI_GATEWAY_API_KEY
```

キー未設定なら通信前に終了する。キーはファイルに保存しない。
モデルは `typesafe-ai/jev`、プロバイダーは `typesafe-ai` に限定する。

## 開発方針

実装は `src/` のTypeScriptをBunで直接実行する。
フック契約・拒否動作のテストは `tests/` に配置して `bun test` で検証する。
テストのJev応答はモックで、有料APIを呼ばない。Unixソケットを作成できる環境が必要。
詳細は [設計書](docs/DESIGN.md)、過去の実測値は [検証レポート](docs/REPORT.md) を参照。
