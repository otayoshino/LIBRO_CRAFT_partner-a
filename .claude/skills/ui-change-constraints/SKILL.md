---
name: ui-change-constraints
description: app/index.html のCSS/HTML/レイアウトを変更する、デザインを調整する、既存UIを触るなど、UI・デザイン変更作業を行う際に使用する。
---

# UI・デザイン変更時の制約

過去の変更履歴・確定仕様は [docs/archive/implementation_guide_v2.md](../../../docs/archive/implementation_guide_v2.md)（完了済み、参考用）を参照。ここでは変更時に必ず守るべき制約のみをまとめる。

## 変更禁止事項

- トップバーの背景色（`#647cc0`）・AUTHORING MODEラベル色・アイコン
- 既存のページレイアウト構造（`.main` / `.view` / `.page`）
- 既存JavaScript関数の挙動（ロジックそのもの）
- 既存の色変数・テーマカラー（サイドバー `#353c47` 等）

変更前後で必ず動作確認を行うこと。

## ボタン位置・サイズの保存形式

異なる画面サイズ間でのズレ対策として、ボタン位置・サイズは紙面に対する**`%`（パーセント）形式**で保存する（[app/js/storage.js](../../../app/js/storage.js) の `saveAnnotations` / `restoreAnnotationsFromArray` 参照）。

- 保存：`style` 文字列内に `left:XX%` / `top:XX%` / `width:XX%` / `height:XX%` を紙面幅・高さから算出して記録するのが現行フォーマット
- 読込：`restoreAnnotationsFromArray` が (1) `%` 形式 → (2) `xRatio`/`yRatio`/`wRatio`/`hRatio` 形式（旧バージョンのJSON） → (3) px絶対値形式（さらに古いJSON）の順に優先して解釈し、いずれの形式で保存されたJSONでも読み込めるようにしている
- **後方互換性が必須**：新形式（`%`）で保存するコードを変更する場合も、(2)(3) の旧形式読込ロジックは残したまま維持すること

このデータ形式に触れるコード（アノテーションの位置・サイズを扱う箇所全般）を変更する際は、3形式すべてに対応しているか確認すること。
