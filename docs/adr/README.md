# ADR

このディレクトリの Architecture Decision Record は、`gril-jev` スキル
（`.claude/skills/gril-jev/SKILL.md`）で作成する。仕様への質問はClaudeが書き、
その回答はユーザーではなくJev（`typesafe-ai/jev`）が返し、決定は人間が確定させる。

- ファイル名は `NNNN-slug.md`（4桁の連番）。1ファイル1決定。
- 雛形は `.claude/skills/gril-jev/reference/adr-template.md`。
- Jevの回答は根拠として全問残し、閾値を満たさなかった項目は「未決事項」に書く。
- 決定を変えるときは既存ADRを書き換えず、新しいADRを作って `状態` を `置換` にする。
