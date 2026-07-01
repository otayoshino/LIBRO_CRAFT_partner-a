\# コーディング規約（このリポジトリ固有）

- コメント・JSDocは日本語（既存コード全体で徹底）。CLAUDE.mdのグローバル指示と同じ方針。
- 状態は `state.js` の単一 `state` オブジェクトに集約する。新しいフラグ/カウンターを増やす場合も個別グローバル変数を増やすのではなく `state` に追加する（`mem:frontend/core` 参照）。
- 各JSファイルは責務ごとに分割されたESモジュールで、named export + `main.js` からの明示的importという形を取る。新規関数もこのパターンに従い、担当モジュールに書いて必要な箇所からimportする。
- アノテーション種別を増やす／挙動を変える際は必ず `.claude/skills/add-annotation-type/SKILL.md` のチェックリストに従う（`config.js` の `ANNOTATION_TYPE_CONFIG` が起点）。
- CSS/HTML/レイアウト変更は `.claude/skills/ui-change-constraints/SKILL.md` の制約（変更禁止のCSS・位置保存形式の移行方針）に従う。
- コミットメッセージ規約は `.claude/skills/git-commit-convention/SKILL.md` を参照（日本語で記述）。
