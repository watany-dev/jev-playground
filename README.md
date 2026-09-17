# Jev Playground

JevをCodexのhooksへ接続するAuto Modeの実装と検証用リポジトリ。

- [セットアップ・動作確認](jev-auto/README.md)
- [hookとJevのログ確認手順](jev-auto/README.md#5-フックとjevのログを確認するb)
- [設計](jev-auto/docs/DESIGN.md)
- [Gateway接続の検証レポート](jev-auto/docs/REPORT.md)
- [仕様をJevに詰めさせてADRを残すスキル](.claude/skills/gril-jev/SKILL.md)（[ADR置き場](docs/adr/README.md)）

ログは起動時の `audit:` に表示されたディレクトリで確認する。保存先は起動ごとに変わるため、shadowからautoへの切り替え時も選び直す。
