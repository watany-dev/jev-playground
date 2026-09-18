# Jev Playground

JevをCodexのhooksへ接続するAuto Modeの実装と検証用リポジトリ。

- [セットアップ・動作確認](jev-auto/README.md)
- [hookとJevのログ確認手順](jev-auto/README.md#5-フックとjevのログを確認するb)
- [設計](jev-auto/docs/DESIGN.md)
- [Gateway接続の検証レポート](jev-auto/docs/REPORT.md)
- [仕様をJevに詰めさせてADRを残すスキル](.claude/skills/gril-jev/SKILL.md)（[ADR置き場](docs/adr/README.md)）
- [47都道府県あてフォーム (Python/uv)](jev-form/README.md) — Jevの確率分布をそのまま見るサンプル
- [記事: Jevの確率分布をそのまま見る](jev-form/blog/guessing-prefectures-with-jev.md)
- [RGBを0〜255で聞くサンプル (TypeScript/Bun)](jev-rgb/README.md) — 順序のある量をscoreで受け取り、分布から色を組み立てる
- [記事: JevにRGBを0〜255で聞く](jev-rgb/blog/asking-jev-for-rgb.md)

ログは起動時の `audit:` に表示されたディレクトリで確認する。保存先は起動ごとに変わるため、shadowからautoへの切り替え時も選び直す。
